import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus, type User } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { UserService } from '../user/user.service';
import { ApplicationService } from '../application/application.service';
import { parseStringArray } from '../../common/utils/json.util';
import { SecretService } from '../../common/security/secret.service';

/**
 * Thrown when a social login has no bound account and publicApiEnabled is false.
 * The controller catches this and redirects to the "bind existing account" page.
 */
export class SocialBindRequiredError extends Error {
  constructor(public readonly socialProfile: SocialUserProfile) {
    super('SOCIAL_BIND_REQUIRED');
    this.name = 'SocialBindRequiredError';
  }
}

interface ProviderEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  userInfoEmailUrl?: string;
  openidUrl?: string;
  scope: string;
  tokenMethod: 'POST' | 'GET';
  tokenContentType: string;
  parseTokenResponse: (body: string) => { accessToken: string; openid?: string };
}

const PROVIDER_CONFIGS: Record<string, ProviderEndpoints> = {
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    userInfoEmailUrl: 'https://api.github.com/user/emails',
    scope: 'user:email',
    tokenMethod: 'POST',
    tokenContentType: 'application/x-www-form-urlencoded',
    parseTokenResponse: (body) => {
      const params = new URLSearchParams(body);
      const token = params.get('access_token');
      if (!token) throw new Error('Failed to parse GitHub token response');
      return { accessToken: token };
    },
  },
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    tokenMethod: 'POST',
    tokenContentType: 'application/x-www-form-urlencoded',
    parseTokenResponse: (body) => {
      const data = JSON.parse(body) as { access_token: string };
      if (!data.access_token) throw new Error('Failed to parse Google token response');
      return { accessToken: data.access_token };
    },
  },
  wechat: {
    authorizeUrl: 'https://open.weixin.qq.com/connect/qrconnect',
    tokenUrl: 'https://api.weixin.qq.com/sns/oauth2/access_token',
    userInfoUrl: 'https://api.weixin.qq.com/sns/userinfo',
    scope: 'snsapi_login',
    tokenMethod: 'GET',
    tokenContentType: 'application/json',
    parseTokenResponse: (body) => {
      const data = JSON.parse(body) as { access_token: string; openid: string; errcode?: number; errmsg?: string };
      if (data.errcode) throw new Error(`WeChat error: ${data.errmsg}`);
      return { accessToken: data.access_token, openid: data.openid };
    },
  },
  qq: {
    authorizeUrl: 'https://graph.qq.com/oauth2.0/authorize',
    tokenUrl: 'https://graph.qq.com/oauth2.0/token',
    userInfoUrl: 'https://graph.qq.com/user/get_user_info',
    openidUrl: 'https://graph.qq.com/oauth2.0/me',
    scope: 'get_user_info',
    tokenMethod: 'GET',
    tokenContentType: 'application/json',
    parseTokenResponse: (body) => {
      const params = new URLSearchParams(body);
      const token = params.get('access_token');
      if (!token) throw new Error('Failed to parse QQ token response');
      return { accessToken: token };
    },
  },
};

interface SocialUserProfile {
  provider: string;
  providerUserId: string;
  providerAppId?: string | null;
  openid?: string | null;
  unionid?: string | null;
  email: string | null;
  phone?: string | null;
  username: string;
  displayName?: string | null;
  avatar: string | null;
  rawProfile?: Record<string, unknown> | null;
}

type SocialIdentityStrategy =
  | 'unionid_or_app_openid'
  | 'unionid_only'
  | 'app_openid'
  | 'provider_user_id';

type SocialProfileSyncMode =
  | 'fill_missing'
  | 'every_login'
  | 'registration_only';

interface SocialProviderRuntimeConfig {
  name: string;
  type: string;
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  apiUrl: string | null;
  redirectUri: string | null;
  scopes: string | null;
  authUrl: string | null;
  tokenUrl: string | null;
  userInfoUrl: string | null;
  fieldMapping: string | null;
  signatureSecret: string;
  ipWhitelist: string | null;
  identityStrategy: string;
  profileSyncMode: string;
  miniProgramUseDynamicCode: boolean;
  miniProgramSubmitFields: string | null;
}

interface SocialProviderPolicy {
  identityStrategy: SocialIdentityStrategy;
  profileSyncMode: SocialProfileSyncMode;
  fieldMapping: Record<string, string>;
  miniProgramUseDynamicCode: boolean;
  miniProgramSubmitFields: string[];
}

interface PendingBindState {
  userId: string;
  provider: string;
  returnTo: string;
  expiresAt: string;
  status?: 'pending' | 'scanned' | 'completed' | 'failed';
  bindingId?: string;
  error?: string;
  completedAt?: string;
  scannedAt?: string;
}

interface PendingLoginState {
  provider: string;
  clientId?: string | null;
  redirectUri?: string | null;
  expiresAt: string;
  status?: 'pending' | 'scanned' | 'completed' | 'failed';
  auth?: Record<string, unknown>;
  authTicket?: string;
  error?: string;
  completedAt?: string;
  scannedAt?: string;
  miniProgramPath?: string;
  scene?: string;
}

interface SocialLoginApplicationContext {
  clientId?: string | null;
  redirectUri?: string | null;
}

interface SocialUserResolutionOptions {
  autoCreateUnboundUser?: boolean;
}

interface SocialCallbackSecurityContext {
  query?: Record<string, unknown>;
  requestIp?: string | null;
}

interface WechatMiniLoginConfirmPayload {
  state: string;
  jsCode?: string;
  providerUserId?: string;
  openid?: string;
  unionid?: string;
  nickName?: string;
  nickname?: string;
  avatarUrl?: string;
  avatar?: string;
  profile?: Record<string, unknown>;
}

interface WechatMiniSessionIdentity {
  openid: string;
  unionid?: string;
  sessionKey?: string;
}

type WechatMiniQrMode = 'dynamic' | 'fixed' | 'fallback' | 'platform';

interface AuthorizationPayload {
  authorizeUrl: string;
  qrCodeUrl?: string | null;
  state?: string;
  miniProgramPath?: string;
  scene?: string;
  qrMode?: WechatMiniQrMode;
  qrContent?: string;
  expiresIn?: number;
}

const SOCIAL_BIND_STATE_PREFIX = 'social-bind-state:';
const SOCIAL_LOGIN_STATE_PREFIX = 'social-login-state:';
const SOCIAL_LOGIN_TICKET_PREFIX = 'social-login-ticket:';
const WECHAT_PROVIDER_NAMES = ['wechat', 'wechat-aggregated', 'wechat-mini'];

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly applicationService: ApplicationService,
    private readonly configService: ConfigService,
    private readonly secretService: SecretService,
  ) {}

  private decryptProviderRecord<T extends { clientSecret: string; signatureSecret: string }>(
    provider: T,
  ): T {
    return {
      ...provider,
      clientSecret: this.secretService.decryptMaybe(provider.clientSecret),
      signatureSecret: this.secretService.decryptMaybe(provider.signatureSecret),
    };
  }

  private getBackendBaseUrl(): string {
    const port = this.configService.get<number>('PORT') ?? 3000;
    const issuer = this.configService.get<string>('OIDC_ISSUER') ?? `http://localhost:${port}`;
    return issuer;
  }

  private getOAuthCallbackBaseUrl(): string {
    return this.configService.get<string>('OAUTH_CALLBACK_BASE_URL') ?? this.getBackendBaseUrl();
  }

  private getFrontendUrl(): string {
    return this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
  }

  private getWechatMiniLoginPage(providerRecord?: { redirectUri?: string | null }): string {
    return providerRecord?.redirectUri?.trim()
      || this.configService.get<string>('WECHAT_MINI_PROGRAM_LOGIN_PAGE')
      || 'pages/wechat-scan-login/wechat-scan-login';
  }

  private getWechatMiniQrImageUrl(providerRecord?: { authUrl?: string | null }): string {
    const configured = providerRecord?.authUrl?.trim()
      || this.configService.get<string>('WECHAT_MINI_PROGRAM_QR_IMAGE_URL')?.trim()
      || '';
    if (configured) {
      return configured;
    }

    const defaultUploadQrPath = join(process.cwd(), 'uploads', 'wechat-mini-qr.jpg');
    return existsSync(defaultUploadQrPath) ? '/uploads/wechat-mini-qr.jpg' : '';
  }

  private getWechatMiniEnvVersion(): 'release' | 'trial' | 'develop' {
    return this.configService.get<'release' | 'trial' | 'develop'>('WECHAT_MINI_PROGRAM_ENV_VERSION') ?? 'release';
  }

  private isWechatMiniInsecureIdentityAllowed(): boolean {
    return this.configService.get<boolean>('WECHAT_MINI_PROGRAM_ALLOW_INSECURE_IDENTITY') ?? false;
  }

  private describeExternalError(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  }

  private normalizeIdentityStrategy(value?: string | null): SocialIdentityStrategy {
    switch (value) {
      case 'unionid_only':
      case 'app_openid':
      case 'provider_user_id':
      case 'unionid_or_app_openid':
        return value;
      default:
        return 'unionid_or_app_openid';
    }
  }

  private normalizeProfileSyncMode(value?: string | null): SocialProfileSyncMode {
    switch (value) {
      case 'every_login':
      case 'registration_only':
      case 'fill_missing':
        return value;
      default:
        return 'fill_missing';
    }
  }

  private parseFieldMapping(value?: string | null) {
    const trimmed = value?.trim();
    if (!trimmed) {
      return {};
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      return Object.fromEntries(
        Object.entries(parsed)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .map(([key, path]) => [key, path.trim()])
          .filter(([, path]) => path),
      );
    } catch {
      const entries = trimmed
        .split(/[\r\n,]+/)
        .map((line) => line.trim())
        .map((line) => line.match(/^([\w.-]+)\s*[:=]\s*(.+)$/))
        .filter((match): match is RegExpMatchArray => Boolean(match))
        .map((match) => [match[1], match[2].trim()] as const)
        .filter(([, path]) => path);

      return Object.fromEntries(entries);
    }
  }

  private parseConfigStringList(value?: string | null) {
    const trimmed = value?.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      // Fall back to newline/comma separated text.
    }

    return trimmed
      .split(/[\r\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private normalizeRequestIp(value?: string | null) {
    const first = value?.split(',')[0]?.trim();
    if (!first) {
      return null;
    }

    const withoutIpv6Prefix = first.startsWith('::ffff:')
      ? first.slice('::ffff:'.length)
      : first;
    const bracketMatch = withoutIpv6Prefix.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (bracketMatch) {
      return bracketMatch[1];
    }

    const ipv4WithPort = withoutIpv6Prefix.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
    return ipv4WithPort ? ipv4WithPort[1] : withoutIpv6Prefix;
  }

  private ipv4ToNumber(ip: string) {
    const parts = ip.split('.');
    if (parts.length !== 4) {
      return null;
    }

    return parts.reduce<number | null>((acc, part) => {
      if (acc === null || !/^\d+$/.test(part)) {
        return null;
      }
      const value = Number(part);
      if (value < 0 || value > 255) {
        return null;
      }
      return ((acc << 8) + value) >>> 0;
    }, 0);
  }

  private isIpAllowedByRule(requestIp: string, rule: string) {
    const cidrMatch = rule.match(/^(.+)\/(\d{1,2})$/);
    if (cidrMatch) {
      const networkIp = this.normalizeRequestIp(cidrMatch[1]);
      const prefix = Number(cidrMatch[2]);
      const requestNumber = this.ipv4ToNumber(requestIp);
      const networkNumber = networkIp ? this.ipv4ToNumber(networkIp) : null;

      if (
        requestNumber === null ||
        networkNumber === null ||
        prefix < 0 ||
        prefix > 32
      ) {
        return false;
      }

      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      return (requestNumber & mask) === (networkNumber & mask);
    }

    return requestIp === this.normalizeRequestIp(rule);
  }

  private getFirstQueryValue(value: unknown) {
    if (Array.isArray(value)) {
      return typeof value[0] === 'string' ? value[0] : undefined;
    }
    return typeof value === 'string' ? value : undefined;
  }

  private buildSignaturePayload(query: Record<string, unknown>) {
    return Object.entries(query)
      .filter(([key]) => !['sign', 'signature'].includes(key.toLowerCase()))
      .flatMap(([key, value]) => {
        if (Array.isArray(value)) {
          return value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => [key, item] as const);
        }
        return typeof value === 'string' ? [[key, value] as const] : [];
      })
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        const keyCompare = leftKey.localeCompare(rightKey);
        return keyCompare === 0 ? leftValue.localeCompare(rightValue) : keyCompare;
      })
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
  }

  private safeCompare(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer);
  }

  private verifyCallbackSignature(
    signature: string,
    query: Record<string, unknown>,
    secret: string,
  ) {
    const payload = this.buildSignaturePayload(query);
    const expectedHex = createHmac('sha256', secret).update(payload).digest('hex');
    const expectedBase64 = createHmac('sha256', secret).update(payload).digest('base64');
    const normalizedSignature = signature.trim();

    if (/^[a-f0-9]{64}$/i.test(normalizedSignature)) {
      return this.safeCompare(expectedHex, normalizedSignature.toLowerCase());
    }

    return this.safeCompare(expectedBase64, normalizedSignature);
  }

  private validateCallbackSecurity(
    providerRecord: SocialProviderRuntimeConfig,
    context?: SocialCallbackSecurityContext,
  ) {
    const whitelist = this.parseConfigStringList(providerRecord.ipWhitelist);
    if (whitelist.length > 0) {
      const requestIp = this.normalizeRequestIp(context?.requestIp);
      if (!requestIp || !whitelist.some((rule) => this.isIpAllowedByRule(requestIp, rule))) {
        throw new BadRequestException('第三方回调来源 IP 不在白名单内');
      }
    }

    const signatureSecret = providerRecord.signatureSecret?.trim();
    if (!signatureSecret) {
      return;
    }

    const query = context?.query;
    const signature = query
      ? this.getFirstQueryValue(query.sign) ?? this.getFirstQueryValue(query.signature)
      : undefined;

    if (!signature) {
      if (providerRecord.type === 'aggregated') {
        throw new BadRequestException('第三方回调缺少签名参数');
      }
      return;
    }

    if (!this.verifyCallbackSignature(signature, query ?? {}, signatureSecret)) {
      throw new BadRequestException('第三方回调签名校验失败');
    }
  }

  private parseProviderPolicy(
    providerRecord?: Partial<SocialProviderRuntimeConfig> | null,
  ): SocialProviderPolicy {
    const miniProgramSubmitFields = providerRecord?.miniProgramSubmitFields
      ? parseStringArray(providerRecord.miniProgramSubmitFields)
      : [];

    return {
      identityStrategy: this.normalizeIdentityStrategy(providerRecord?.identityStrategy),
      profileSyncMode: this.normalizeProfileSyncMode(providerRecord?.profileSyncMode),
      fieldMapping: this.parseFieldMapping(providerRecord?.fieldMapping),
      miniProgramUseDynamicCode: providerRecord?.miniProgramUseDynamicCode ?? true,
      miniProgramSubmitFields: miniProgramSubmitFields.length > 0
        ? [...new Set(miniProgramSubmitFields)]
        : ['jsCode'],
    };
  }

  private readMappedValue(source: unknown, path?: string) {
    if (!path || source === null || source === undefined) {
      return undefined;
    }

    return path
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .reduce<unknown>((current, segment) => {
        if (current === null || current === undefined) {
          return undefined;
        }

        if (Array.isArray(current) && /^\d+$/.test(segment)) {
          return current[Number(segment)];
        }

        if (typeof current === 'object' && segment in current) {
          return (current as Record<string, unknown>)[segment];
        }

        return undefined;
      }, source);
  }

  private getMappedString(
    source: unknown,
    mapping: Record<string, string>,
    keys: string[],
    fallbackPaths: string[],
  ) {
    const paths = [
      ...keys.map((key) => mapping[key]).filter((path): path is string => Boolean(path)),
      ...fallbackPaths,
    ];

    for (const path of paths) {
      const value = this.readMappedValue(source, path);
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number' || typeof value === 'bigint') {
        return String(value);
      }
    }

    return null;
  }

  private buildMappedSocialProfile(
    provider: string,
    data: Record<string, unknown>,
    mapping: Record<string, string>,
    defaults?: Partial<SocialUserProfile>,
  ): SocialUserProfile {
    const providerUserId = this.getMappedString(
      data,
      mapping,
      ['providerUserId', 'userId', 'uniqueId', 'id'],
      ['id', 'sub', 'social_uid', 'uid', 'unionid', 'openid'],
    );
    if (!providerUserId) {
      throw new BadRequestException(`第三方登录 ${provider} 未返回用户唯一 ID`);
    }

    const openid = this.getMappedString(data, mapping, ['openid', 'openId'], ['openid', 'open_id']);
    const unionid = this.getMappedString(data, mapping, ['unionid', 'unionId'], ['unionid', 'union_id']);
    const nickname = this.getMappedString(
      data,
      mapping,
      ['nickname', 'nickName', 'username', 'displayName', 'name'],
      ['nickname', 'nickName', 'name', 'login', 'username'],
    ) ?? defaults?.username ?? `${provider}_${providerUserId.slice(0, 8)}`;

    return {
      provider,
      providerUserId,
      providerAppId: defaults?.providerAppId ?? this.getMappedString(data, mapping, ['providerAppId', 'appId'], ['appid', 'app_id']),
      openid: openid ?? defaults?.openid ?? null,
      unionid: unionid ?? defaults?.unionid ?? null,
      email: this.getMappedString(data, mapping, ['email'], ['email']) ?? defaults?.email ?? null,
      phone: this.getMappedString(data, mapping, ['phone', 'mobile'], ['phone', 'phoneNumber', 'mobile']) ?? defaults?.phone ?? null,
      username: nickname,
      displayName: this.getMappedString(data, mapping, ['displayName'], ['displayName', 'name']) ?? nickname,
      avatar: this.getMappedString(
        data,
        mapping,
        ['avatar', 'avatarUrl', 'picture'],
        ['avatar', 'avatarUrl', 'avatar_url', 'picture', 'headimgurl', 'faceimg', 'figureurl_qq'],
      ) ?? defaults?.avatar ?? null,
      rawProfile: data,
    };
  }

  private resolveOAuthRedirectUri(
    providerRecord: { redirectUri?: string | null },
    callbackPath: string,
  ) {
    const configured = providerRecord.redirectUri?.trim();
    const callbackQuery = callbackPath.includes('?')
      ? callbackPath.slice(callbackPath.indexOf('?'))
      : '';

    if (!configured) {
      return `${this.getOAuthCallbackBaseUrl()}${callbackPath}`;
    }

    if (/^https?:\/\//i.test(configured)) {
      const parsed = new URL(configured);
      const hasExplicitPath = parsed.pathname && parsed.pathname !== '/';
      if (hasExplicitPath) {
        return callbackQuery && !parsed.search
          ? `${configured}${callbackQuery}`
          : configured;
      }
      return `${configured.replace(/\/+$/, '')}${callbackPath}`;
    }

    if (configured.startsWith('/')) {
      return `${this.getOAuthCallbackBaseUrl()}${configured}`;
    }

    return `https://${configured.replace(/\/+$/, '')}${callbackPath}`;
  }

  async assertProviderAllowedForApplication(
    provider: string,
    clientId?: string | null,
    redirectUri?: string | null,
  ) {
    if ((clientId && !redirectUri) || (!clientId && redirectUri)) {
      throw new BadRequestException('第三方登录需要完整的应用上下文');
    }

    if (!clientId || !redirectUri) {
      return null;
    }

    const { application } = await this.applicationService.resolveAuthorizeContext(
      clientId,
      redirectUri,
    );
    const allowedProviders = application.enabledSocialProviders
      ? parseStringArray(application.enabledSocialProviders)
      : [];

    const isWechatProvider = WECHAT_PROVIDER_NAMES.includes(provider);
    const isAllowed = allowedProviders.includes(provider) ||
      (isWechatProvider && allowedProviders.some((item) => WECHAT_PROVIDER_NAMES.includes(item)));

    if (!isAllowed) {
      throw new BadRequestException('该应用未开启当前第三方登录方式');
    }

    return application;
  }

  private async getWechatMiniProviderRecord(requireEnabled = false) {
    const provider = await this.prismaService.socialProvider.findUnique({
      where: { name: 'wechat-mini' },
    });

    if (!provider) {
      if (requireEnabled) {
        throw new BadRequestException('微信扫码登录未配置，请先在后台系统设置中初始化并启用微信');
      }
      return null;
    }

    if (requireEnabled && !provider.enabled) {
      throw new BadRequestException('微信扫码登录未启用，请在后台开启微信');
    }

    return this.decryptProviderRecord(provider);
  }

  private buildBindStateKey(state: string) {
    return `${SOCIAL_BIND_STATE_PREFIX}${state}`;
  }

  private buildLoginStateKey(state: string) {
    return `${SOCIAL_LOGIN_STATE_PREFIX}${state}`;
  }

  private buildLoginTicketKey(ticket: string) {
    return `${SOCIAL_LOGIN_TICKET_PREFIX}${ticket}`;
  }

  async createLoginTicket(auth: Record<string, unknown>) {
    const ticket = randomBytes(32).toString('base64url');
    await this.prismaService.systemSetting.create({
      data: {
        key: this.buildLoginTicketKey(ticket),
        value: JSON.stringify({
          auth,
          expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        }),
      },
    });
    return ticket;
  }

  async redeemLoginTicket(ticket: string) {
    const normalized = ticket?.trim();
    if (!normalized) {
      throw new BadRequestException('登录凭证无效');
    }

    const key = this.buildLoginTicketKey(normalized);
    const setting = await this.prismaService.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      throw new BadRequestException('登录凭证无效或已过期');
    }

    await this.prismaService.systemSetting.delete({ where: { key } });

    try {
      const payload = JSON.parse(setting.value) as {
        auth?: Record<string, unknown>;
        expiresAt?: string;
      };
      if (!payload.auth || !payload.expiresAt || new Date(payload.expiresAt).getTime() <= Date.now()) {
        throw new BadRequestException('登录凭证无效或已过期');
      }
      return payload.auth;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('登录凭证无效或已过期');
    }
  }

  private normalizeReturnTo(returnTo?: string) {
    return returnTo?.startsWith('/') ? returnTo : '/console/account';
  }

  private parseStoredProfile(profile: string) {
    try {
      return JSON.parse(profile) as Partial<SocialUserProfile>;
    } catch {
      return {};
    }
  }

  private toApiBinding(account: {
    id: string;
    provider: string;
    providerAppId?: string | null;
    providerUserId: string;
    openid?: string | null;
    unionid?: string | null;
    nickname?: string | null;
    avatar?: string | null;
    profile: string;
    lastLoginAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const profile = this.parseStoredProfile(account.profile);

    return {
      id: account.id,
      provider: account.provider,
      providerAppId: account.providerAppId ?? null,
      providerUserId: account.providerUserId,
      openid: account.openid ?? null,
      unionid: account.unionid ?? null,
      username:
        account.nickname ?? (typeof profile.username === 'string' ? profile.username : null),
      email: typeof profile.email === 'string' ? profile.email : null,
      avatar: account.avatar ?? (typeof profile.avatar === 'string' ? profile.avatar : null),
      lastLoginAt: account.lastLoginAt ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  private buildSocialFallbackEmail(provider: string, providerUserId: string) {
    return `${provider}_${providerUserId}@social.local`;
  }

  private buildAppOpenidProviderUserId(profile: SocialUserProfile) {
    if (!profile.providerAppId?.trim() || !profile.openid?.trim()) {
      return null;
    }

    return this.normalizeProviderUserId(
      `${profile.providerAppId}.${profile.openid}`,
    );
  }

  private buildCanonicalProviderUserId(
    profile: SocialUserProfile,
    policy = this.parseProviderPolicy(null),
  ) {
    if (policy.identityStrategy === 'provider_user_id') {
      return this.normalizeProviderUserId(profile.providerUserId);
    }

    if (policy.identityStrategy === 'unionid_only') {
      if (!profile.unionid?.trim()) {
        throw new BadRequestException(`${profile.provider} 未返回 unionid，无法按 unionid 统一身份`);
      }
      return this.normalizeProviderUserId(profile.unionid);
    }

    if (policy.identityStrategy === 'app_openid') {
      const appOpenid = this.buildAppOpenidProviderUserId(profile);
      if (!appOpenid) {
        throw new BadRequestException(`${profile.provider} 未返回 AppID + openid，无法按应用 openid 识别身份`);
      }
      return appOpenid;
    }

    if (profile.unionid?.trim()) {
      return this.normalizeProviderUserId(profile.unionid);
    }

    const appOpenid = this.buildAppOpenidProviderUserId(profile);
    if (appOpenid) {
      return appOpenid;
    }

    return this.normalizeProviderUserId(profile.providerUserId);
  }

  private buildSocialAccountProfile(
    profile: SocialUserProfile,
    policy = this.parseProviderPolicy(null),
  ) {
    return {
      provider: profile.provider,
      providerUserId: this.buildCanonicalProviderUserId(profile, policy),
      providerAppId: profile.providerAppId ?? null,
      openid: profile.openid ?? null,
      unionid: profile.unionid ?? null,
      email: profile.email,
      phone: profile.phone ?? null,
      username: profile.username,
      displayName: profile.displayName ?? profile.username,
      avatar: profile.avatar,
    };
  }

  private buildSocialAccountData(
    profile: SocialUserProfile,
    accessToken: string,
    policy = this.parseProviderPolicy(null),
  ) {
    const accountProfile = this.buildSocialAccountProfile(profile, policy);
    const rawProfile = {
      ...accountProfile,
      raw: profile.rawProfile ?? null,
    };

    return {
      provider: profile.provider,
      providerAppId: profile.providerAppId ?? null,
      providerUserId: accountProfile.providerUserId,
      openid: profile.openid ?? null,
      unionid: profile.unionid ?? null,
      accessToken: accessToken ? this.secretService.encrypt(accessToken) : '',
      refreshToken: null,
      nickname: profile.displayName ?? profile.username,
      avatar: profile.avatar,
      profile: JSON.stringify(accountProfile),
      rawProfile: JSON.stringify(rawProfile),
      lastLoginAt: new Date(),
    };
  }

  private async buildUserSocialLoginUpdate(
    user: {
      id: string;
      email: string | null;
      phone: string | null;
      avatar: string | null;
      displayName?: string | null;
    },
    profile: SocialUserProfile,
    policy = this.parseProviderPolicy(null),
  ) {
    const data: {
      displayName?: string;
      email?: string;
      emailVerified?: boolean;
      phone?: string;
      avatar?: string;
      lastLoginAt: Date;
    } = {
      lastLoginAt: new Date(),
    };

    if (policy.profileSyncMode === 'registration_only') {
      return data;
    }

    const shouldOverwrite = policy.profileSyncMode === 'every_login';
    const displayName = profile.displayName?.trim() || profile.username.trim();
    if ((shouldOverwrite || !user.displayName) && displayName) {
      data.displayName = displayName;
    }

    if ((shouldOverwrite || !user.avatar) && profile.avatar) {
      data.avatar = profile.avatar;
    }

    if ((shouldOverwrite || !user.email) && profile.email) {
      const existingEmailOwner = await this.prismaService.user.findUnique({
        where: { email: profile.email },
      });
      if (!existingEmailOwner || existingEmailOwner.id === user.id) {
        data.email = profile.email;
        data.emailVerified = true;
      }
    }

    if ((shouldOverwrite || !user.phone) && profile.phone) {
      const existingPhoneOwner = await this.prismaService.user.findUnique({
        where: { phone: profile.phone },
      });
      if (!existingPhoneOwner || existingPhoneOwner.id === user.id) {
        data.phone = profile.phone;
      }
    }

    return data;
  }

  private async updateUserAfterSocialLogin<T extends { id: string }>(
    user: T & {
      email: string | null;
      phone: string | null;
      avatar: string | null;
      displayName?: string | null;
    },
    profile: SocialUserProfile,
    policy = this.parseProviderPolicy(null),
  ) {
    const data = await this.buildUserSocialLoginUpdate(user, profile, policy);
    return this.prismaService.user.update({
      where: { id: user.id },
      data,
    });
  }

  private async findSocialAccountByIdentity(
    profile: SocialUserProfile,
    policy = this.parseProviderPolicy(null),
  ) {
    const providerUserId = this.buildCanonicalProviderUserId(profile, policy);
    const exact = await this.prismaService.socialAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: profile.provider,
          providerUserId,
        },
      },
      include: { user: true },
    });

    if (exact) {
      return exact;
    }

    const rawProviderUserId = this.normalizeProviderUserId(profile.providerUserId);
    if (rawProviderUserId !== providerUserId) {
      const byRawProviderUserId = await this.prismaService.socialAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: profile.provider,
            providerUserId: rawProviderUserId,
          },
        },
        include: { user: true },
      });
      if (byRawProviderUserId) {
        return byRawProviderUserId;
      }
    }

    if (profile.unionid) {
      const byUnionId = await this.prismaService.socialAccount.findFirst({
        where: {
          unionid: profile.unionid,
        },
        include: { user: true },
        orderBy: { updatedAt: 'desc' },
      });
      if (byUnionId) {
        return byUnionId;
      }
    }

    if (profile.providerAppId && profile.openid) {
      return this.prismaService.socialAccount.findFirst({
        where: {
          provider: profile.provider,
          providerAppId: profile.providerAppId,
          openid: profile.openid,
        },
        include: { user: true },
        orderBy: { updatedAt: 'desc' },
      });
    }

    return null;
  }

  private async upsertSocialAccountForUser(
    userId: string,
    profile: SocialUserProfile,
    accessToken: string,
    policy = this.parseProviderPolicy(null),
    existingAccountId?: string | null,
  ) {
    const data = this.buildSocialAccountData(profile, accessToken, policy);
    const existing = existingAccountId
      ? await this.prismaService.socialAccount.findUnique({
          where: { id: existingAccountId },
        })
      : await this.prismaService.socialAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: data.provider,
            providerUserId: data.providerUserId,
          },
        },
      });

    if (existing) {
      return this.prismaService.socialAccount.update({
        where: { id: existing.id },
        data: {
          userId,
          providerAppId: data.providerAppId,
          openid: data.openid,
          unionid: data.unionid,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          nickname: data.nickname,
          avatar: data.avatar,
          profile: data.profile,
          rawProfile: data.rawProfile,
          lastLoginAt: data.lastLoginAt,
        },
      });
    }

    return this.prismaService.socialAccount.create({
      data: {
        userId,
        ...data,
      },
    });
  }

  private async buildUniqueSocialUsername(username: string, provider: string) {
    const normalized = username
      .trim()
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    const base = normalized || `${provider}_user`;

    for (let index = 0; index < 20; index += 1) {
      const candidate = index === 0
        ? base
        : `${base}_${randomBytes(3).toString('hex')}`;
      const existing = await this.prismaService.user.findUnique({
        where: { username: candidate },
      });
      if (!existing) {
        return candidate;
      }
    }

    return `${provider}_${randomBytes(8).toString('hex')}`;
  }

  private async ensureSocialPlaceholderUser(profile: SocialUserProfile) {
    const fallbackEmail = this.buildSocialFallbackEmail(
      profile.provider,
      profile.providerUserId,
    );

    const existing = await this.prismaService.user.findFirst({
      where: {
        email: fallbackEmail,
        registrationSource: profile.provider,
      },
    });

    if (existing) {
      return existing;
    }

    return this.prismaService.user.create({
      data: {
        email: fallbackEmail,
        username: await this.buildUniqueSocialUsername(
          profile.username,
          profile.provider,
        ),
        displayName: profile.displayName ?? profile.username,
        avatar: profile.avatar,
        emailVerified: false,
        status: UserStatus.ACTIVE,
        registrationSource: profile.provider,
      },
    });
  }

  private async createPendingBindState(
    userId: string,
    provider: string,
    returnTo?: string,
  ) {
    const state = randomBytes(24).toString('base64url');
    const payload: PendingBindState = {
      userId,
      provider,
      returnTo: this.normalizeReturnTo(returnTo),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };

    await this.prismaService.systemSetting.create({
      data: {
        key: this.buildBindStateKey(state),
        value: JSON.stringify(payload),
      },
    });

    return state;
  }

  private async createPendingLoginState(
    provider: string,
    clientId?: string | null,
    redirectUri?: string | null,
    extra?: Partial<PendingLoginState>,
    stateOverride?: string,
  ) {
    const state = stateOverride ?? randomBytes(24).toString('base64url');
    const payload: PendingLoginState = {
      provider,
      clientId: clientId ?? null,
      redirectUri: redirectUri ?? null,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      status: 'pending',
      ...extra,
    };

    await this.prismaService.systemSetting.create({
      data: {
        key: this.buildLoginStateKey(state),
        value: JSON.stringify(payload),
      },
    });

    return state;
  }

  private async consumePendingBindState(state?: string) {
    if (!state) {
      return null;
    }

    const key = this.buildBindStateKey(state);
    const setting = await this.prismaService.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      return null;
    }

    try {
      const payload = JSON.parse(setting.value) as PendingBindState;

      if (new Date(payload.expiresAt).getTime() <= Date.now()) {
        await this.prismaService.systemSetting.delete({
          where: { key },
        });
        return null;
      }

      if (payload.status === 'completed' || payload.status === 'failed') {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  private async markPendingBindStateCompleted(
    state: string | undefined,
    bindingId: string,
  ) {
    if (!state) {
      return;
    }

    const key = this.buildBindStateKey(state);
    const setting = await this.prismaService.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      return;
    }

    try {
      const payload = JSON.parse(setting.value) as PendingBindState;
      await this.prismaService.systemSetting.update({
        where: { key },
        data: {
          value: JSON.stringify({
            ...payload,
            status: 'completed',
            bindingId,
            completedAt: new Date().toISOString(),
          } satisfies PendingBindState),
        },
      });
    } catch {
      await this.prismaService.systemSetting.delete({ where: { key } });
    }
  }

  private async updatePendingBindState(
    state: string | undefined,
    patch: Partial<PendingBindState>,
  ) {
    if (!state) {
      return;
    }

    const key = this.buildBindStateKey(state);
    const setting = await this.prismaService.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      return;
    }

    try {
      const payload = JSON.parse(setting.value) as PendingBindState;
      await this.prismaService.systemSetting.update({
        where: { key },
        data: {
          value: JSON.stringify({
            ...payload,
            ...patch,
          }),
        },
      });
    } catch {
      await this.prismaService.systemSetting.delete({ where: { key } });
    }
  }

  async getBindAuthorizationStatus(userId: string, state: string) {
    const setting = await this.prismaService.systemSetting.findUnique({
      where: { key: this.buildBindStateKey(state) },
    });

    if (!setting) {
      return { status: 'expired' as const };
    }

    try {
      const payload = JSON.parse(setting.value) as PendingBindState;

      if (payload.userId !== userId) {
        throw new BadRequestException('绑定状态不属于当前用户');
      }

      if (new Date(payload.expiresAt).getTime() <= Date.now()) {
        await this.prismaService.systemSetting.delete({
          where: { key: this.buildBindStateKey(state) },
        });
        return { status: 'expired' as const };
      }

      return {
        status: payload.status === 'completed'
          ? 'completed' as const
          : payload.status === 'failed'
            ? 'failed' as const
            : payload.status === 'scanned'
              ? 'scanned' as const
              : 'pending' as const,
        provider: payload.provider,
        bindingId: payload.bindingId ?? null,
        error: payload.error ?? null,
        completedAt: payload.completedAt ?? null,
        scannedAt: payload.scannedAt ?? null,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      return { status: 'expired' as const };
    }
  }

  private async getPendingLoginState(state?: string) {
    if (!state) {
      return null;
    }

    const setting = await this.prismaService.systemSetting.findUnique({
      where: { key: this.buildLoginStateKey(state) },
    });

    if (!setting) {
      return null;
    }

    try {
      const payload = JSON.parse(setting.value) as PendingLoginState;

      if (new Date(payload.expiresAt).getTime() <= Date.now()) {
        await this.prismaService.systemSetting.delete({
          where: { key: this.buildLoginStateKey(state) },
        });
        return null;
      }

      if (payload.status !== 'pending' && payload.status !== 'scanned') {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  private async updatePendingLoginState(
    state: string | undefined,
    patch: Partial<PendingLoginState>,
  ) {
    if (!state) {
      return;
    }

    const key = this.buildLoginStateKey(state);
    const setting = await this.prismaService.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      return;
    }

    try {
      const payload = JSON.parse(setting.value) as PendingLoginState;
      await this.prismaService.systemSetting.update({
        where: { key },
        data: {
          value: JSON.stringify({
            ...payload,
            ...patch,
          }),
        },
      });
    } catch {
      await this.prismaService.systemSetting.delete({ where: { key } });
    }
  }

  async failAuthorizationState(
    state: string | undefined,
    provider: string | undefined,
    message: string,
  ) {
    if (!state) {
      return null;
    }

    const loginSetting = await this.prismaService.systemSetting.findUnique({
      where: { key: this.buildLoginStateKey(state) },
    });
    if (loginSetting) {
      try {
        const payload = JSON.parse(loginSetting.value) as PendingLoginState;
        if (!provider || payload.provider === provider) {
          await this.updatePendingLoginState(state, {
            status: 'failed',
            error: message,
            completedAt: new Date().toISOString(),
          });
          return 'login' as const;
        }
      } catch {
        await this.prismaService.systemSetting.delete({
          where: { key: this.buildLoginStateKey(state) },
        });
      }
    }

    const bindSetting = await this.prismaService.systemSetting.findUnique({
      where: { key: this.buildBindStateKey(state) },
    });
    if (bindSetting) {
      try {
        const payload = JSON.parse(bindSetting.value) as PendingBindState;
        if (!provider || payload.provider === provider) {
          await this.updatePendingBindState(state, {
            status: 'failed',
            error: message,
            completedAt: new Date().toISOString(),
          });
          return 'bind' as const;
        }
      } catch {
        await this.prismaService.systemSetting.delete({
          where: { key: this.buildBindStateKey(state) },
        });
      }
    }

    return null;
  }

  async createLoginAuthorization(
    provider: string,
    clientId?: string | null,
    redirectUri?: string | null,
  ) {
    await this.assertProviderAllowedForApplication(provider, clientId, redirectUri);
    const csrfState = await this.createPendingLoginState(provider, clientId, redirectUri);
    const authorization = await this.buildAuthorizePayload(
      provider,
      '/api/auth/callback',
      `${csrfState}|${provider}`,
    );

    return {
      authorizeUrl: authorization.authorizeUrl,
      qrCodeUrl: authorization.qrCodeUrl ?? null,
      state: csrfState,
    };
  }

  private buildWechatMiniScene(state: string) {
    return `s=${state}`;
  }

  private buildWechatMiniPath(
    state: string,
    providerRecord?: { redirectUri?: string | null },
  ) {
    const page = this.getWechatMiniLoginPage(providerRecord).replace(/^\//, '');
    return `${page}?state=${encodeURIComponent(state)}`;
  }

  private buildWechatMiniQrFallback(state: string, scene: string, miniProgramPath: string): {
    qrContent: string;
    qrMode: Extract<WechatMiniQrMode, 'fallback' | 'platform'>;
  } {
    const template = this.configService.get<string>('WECHAT_MINI_PROGRAM_SCAN_URL_TEMPLATE')?.trim();
    if (!template) {
      return {
        qrContent: miniProgramPath,
        qrMode: 'fallback',
      };
    }

    return {
      qrContent: template
        .replace(/\{state\}/g, encodeURIComponent(state))
        .replace(/\{scene\}/g, encodeURIComponent(scene))
        .replace(/\{path\}/g, encodeURIComponent(miniProgramPath))
        .replace(/\{miniProgramPath\}/g, encodeURIComponent(miniProgramPath)),
      qrMode: 'platform',
    };
  }

  private async getWechatMiniAccessToken(
    providerRecord?: Partial<SocialProviderRuntimeConfig>,
  ) {
    const appId = providerRecord?.clientId?.trim()
      || this.configService.get<string>('WECHAT_MINI_PROGRAM_APP_ID')?.trim();
    const appSecret = providerRecord?.clientSecret?.trim()
      || this.configService.get<string>('WECHAT_MINI_PROGRAM_APP_SECRET')?.trim();

    if (!appId || !appSecret) {
      return null;
    }

    const params = new URLSearchParams({
      grant_type: 'client_credential',
      appid: appId,
      secret: appSecret,
    });
    let response: Awaited<ReturnType<typeof fetch>>;
    let data: {
      access_token?: string;
      errcode?: number;
      errmsg?: string;
    };

    try {
      response = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${params.toString()}`);
      data = await response.json() as typeof data;
    } catch (error) {
      throw new BadRequestException(
        `获取微信 access_token 失败：${this.describeExternalError(error, '微信接口请求失败')}`,
      );
    }

    if (!response.ok || data.errcode || !data.access_token) {
      throw new BadRequestException(`获取微信 access_token 失败：${data.errmsg ?? response.statusText}`);
    }

    return data.access_token;
  }

  private async buildWechatMiniDynamicQrCode(
    scene: string,
    providerRecord?: Partial<SocialProviderRuntimeConfig>,
  ) {
    const accessToken = await this.getWechatMiniAccessToken(providerRecord);
    if (!accessToken) {
      return null;
    }

    const response = await fetch(
      `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene,
          page: this.getWechatMiniLoginPage(providerRecord).replace(/^\//, ''),
          check_path: false,
          env_version: this.getWechatMiniEnvVersion(),
        }),
      },
    );
    const contentType = response.headers.get('content-type') ?? '';
    const bytes = Buffer.from(await response.arrayBuffer());

    if (!response.ok || contentType.includes('application/json')) {
      let message = response.statusText;
      try {
        const data = JSON.parse(bytes.toString('utf8')) as { errmsg?: string };
        message = data.errmsg ?? message;
      } catch {
        // Keep the HTTP status text when WeChat does not return JSON.
      }
      throw new BadRequestException(`生成微信扫码二维码失败：${message}`);
    }

    return `data:${contentType || 'image/png'};base64,${bytes.toString('base64')}`;
  }

  private async buildWechatMiniQrCodeUrl(
    scene: string,
    providerRecord?: Partial<SocialProviderRuntimeConfig>,
    fallbackMode: Extract<WechatMiniQrMode, 'fallback' | 'platform'> = 'fallback',
  ) {
    const policy = this.parseProviderPolicy(providerRecord);
    if (policy.miniProgramUseDynamicCode) {
      try {
        const dynamicQrCode = await this.buildWechatMiniDynamicQrCode(scene, providerRecord);
        if (dynamicQrCode) {
          return {
            qrCodeUrl: dynamicQrCode,
            qrMode: 'dynamic' as const,
          };
        }
      } catch (error) {
        this.logger.warn(
          `WeChat mini dynamic QR generation failed, falling back: ${this.describeExternalError(error, 'unknown error')}`,
        );
      }

      const fixedQrImageUrl = this.getWechatMiniQrImageUrl(providerRecord);
      if (fixedQrImageUrl) {
        return {
          qrCodeUrl: fixedQrImageUrl,
          qrMode: 'fixed' as const,
        };
      }

      return {
        qrCodeUrl: null,
        qrMode: fallbackMode,
      };
    }

    const fixedQrImageUrl = this.getWechatMiniQrImageUrl(providerRecord);
    if (fixedQrImageUrl) {
      return {
        qrCodeUrl: fixedQrImageUrl,
        qrMode: 'fixed' as const,
      };
    }

    return {
      qrCodeUrl: null,
      qrMode: fallbackMode,
    };
  }

  async createWechatMiniLoginAuthorization(
    clientId?: string | null,
    redirectUri?: string | null,
  ) {
    await this.assertProviderAllowedForApplication('wechat-mini', clientId, redirectUri);

    const foundProviderRecord = await this.getWechatMiniProviderRecord(true);
    if (!foundProviderRecord) {
      throw new BadRequestException('微信扫码登录未配置，请先在后台系统设置中初始化并启用微信');
    }
    const providerRecord = foundProviderRecord;
    const state = randomBytes(12).toString('base64url');
    const scene = this.buildWechatMiniScene(state);
    const miniProgramPath = this.buildWechatMiniPath(state, providerRecord);
    const fallback = this.buildWechatMiniQrFallback(state, scene, miniProgramPath);
    const { qrCodeUrl, qrMode } = await this.buildWechatMiniQrCodeUrl(
      scene,
      providerRecord,
      fallback.qrMode,
    );
    const qrContent = fallback.qrContent;

    await this.createPendingLoginState(
      'wechat-mini',
      clientId,
      redirectUri,
      {
        miniProgramPath,
        scene,
      },
      state,
    );

    return {
      state,
      miniProgramPath,
      scene,
      qrCodeUrl,
      qrMode,
      qrContent,
      expiresIn: 10 * 60,
    };
  }

  private pickProfileString(
    payload: WechatMiniLoginConfirmPayload,
    keys: string[],
  ) {
    for (const key of keys) {
      const direct = payload[key as keyof WechatMiniLoginConfirmPayload];
      if (typeof direct === 'string' && direct.trim()) {
        return direct.trim();
      }

      const nested = payload.profile?.[key];
      if (typeof nested === 'string' && nested.trim()) {
        return nested.trim();
      }
    }

    return null;
  }

  private normalizeProviderUserId(providerUserId: string) {
    return providerUserId
      .trim()
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 128);
  }

  private async exchangeWechatMiniSession(
    jsCode?: string,
    providerRecord?: Partial<SocialProviderRuntimeConfig>,
  ) {
    const appId = providerRecord?.clientId?.trim()
      || this.configService.get<string>('WECHAT_MINI_PROGRAM_APP_ID')?.trim();
    const appSecret = providerRecord?.clientSecret?.trim()
      || this.configService.get<string>('WECHAT_MINI_PROGRAM_APP_SECRET')?.trim();

    if (!appId || !appSecret || !jsCode?.trim()) {
      return null;
    }

    const params = new URLSearchParams({
      appid: appId,
      secret: appSecret,
      js_code: jsCode,
      grant_type: 'authorization_code',
    });
    let response: Awaited<ReturnType<typeof fetch>>;
    let data: {
      openid?: string;
      unionid?: string;
      session_key?: string;
      errcode?: number;
      errmsg?: string;
    };

    try {
      response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`);
      data = await response.json() as typeof data;
    } catch (error) {
      throw new BadRequestException(
        `微信登录校验失败：${this.describeExternalError(error, '微信接口请求失败')}`,
      );
    }

    if (!response.ok || data.errcode || !data.openid) {
      throw new BadRequestException(`微信登录校验失败：${data.errmsg ?? response.statusText}`);
    }

    return {
      openid: data.openid,
      unionid: data.unionid,
      sessionKey: data.session_key,
    } satisfies WechatMiniSessionIdentity;
  }

  private async resolveWechatMiniIdentity(
    payload: WechatMiniLoginConfirmPayload,
    providerRecord: Partial<SocialProviderRuntimeConfig>,
    policy: SocialProviderPolicy,
  ) {
    if (policy.miniProgramSubmitFields.includes('jsCode') && !payload.jsCode?.trim()) {
      throw new BadRequestException('微信登录凭证 jsCode 为必填项');
    }

    const identity = await this.exchangeWechatMiniSession(payload.jsCode, providerRecord);
    if (identity) {
      return identity;
    }

    const insecureId = [payload.unionid, payload.openid, payload.providerUserId]
      .find((value) => typeof value === 'string' && value.trim());
    const allowInsecureIdentity =
      this.isWechatMiniInsecureIdentityAllowed() ||
      this.configService.get<string>('NODE_ENV') !== 'production';

    if (allowInsecureIdentity && insecureId?.trim()) {
      return {
        openid: this.normalizeProviderUserId(insecureId),
        unionid: payload.unionid
          ? this.normalizeProviderUserId(payload.unionid)
          : undefined,
      } satisfies WechatMiniSessionIdentity;
    }

    throw new BadRequestException('未配置微信 AppID/AppSecret，无法校验微信登录凭证');
  }

  private assertWechatMiniSubmitFields(
    payload: WechatMiniLoginConfirmPayload,
    policy: SocialProviderPolicy,
  ) {
    const aliases: Record<string, string[]> = {
      jsCode: ['jsCode'],
      nickname: ['nickname', 'nickName'],
      nickName: ['nickName', 'nickname'],
      avatar: ['avatar', 'avatarUrl'],
      avatarUrl: ['avatarUrl', 'avatar'],
      openid: ['openid'],
      unionid: ['unionid'],
      providerUserId: ['providerUserId'],
    };

    for (const field of policy.miniProgramSubmitFields) {
      const keys = aliases[field] ?? [field];
      const value = this.pickProfileString(payload, keys);
      if (!value && field !== 'profile') {
        throw new BadRequestException(`微信确认登录缺少字段：${field}`);
      }
    }
  }

  private async buildWechatMiniSocialProfile(
    payload: WechatMiniLoginConfirmPayload,
    providerRecord: SocialProviderRuntimeConfig,
    policy: SocialProviderPolicy,
  ): Promise<SocialUserProfile> {
    this.assertWechatMiniSubmitFields(payload, policy);
    const identity = await this.resolveWechatMiniIdentity(payload, providerRecord, policy);
    const providerUserId = this.normalizeProviderUserId(
      identity.unionid ?? identity.openid,
    );
    const nickname = this.pickProfileString(payload, ['nickName', 'nickname'])
      ?? `wx_${providerUserId.slice(0, 8)}`;
    const avatar = this.pickProfileString(payload, ['avatarUrl', 'avatar']);

    return {
      provider: 'wechat-mini',
      providerUserId,
      providerAppId: providerRecord.clientId || null,
      openid: identity.openid,
      unionid: identity.unionid ?? null,
      email: null,
      username: await this.buildUniqueSocialUsername(nickname, 'wechat-mini'),
      displayName: nickname,
      avatar,
      rawProfile: {
        jsCode: payload.jsCode ? '[redacted]' : undefined,
        providerUserId: payload.providerUserId,
        openid: payload.openid,
        unionid: payload.unionid,
        nickName: payload.nickName,
        nickname: payload.nickname,
        avatarUrl: payload.avatarUrl,
        avatar: payload.avatar,
        profile: payload.profile ?? null,
      },
    };
  }

  async confirmWechatMiniLogin(payload: WechatMiniLoginConfirmPayload) {
    const pendingLoginState = await this.getPendingLoginState(payload.state);
    const pendingBindState = pendingLoginState
      ? null
      : await this.consumePendingBindState(payload.state);

    if (
      (!pendingLoginState || pendingLoginState.provider !== 'wechat-mini') &&
      (!pendingBindState || pendingBindState.provider !== 'wechat-mini')
    ) {
      throw new BadRequestException('微信扫码会话已过期，请重新发起');
    }

    try {
      const foundProviderRecord = await this.getWechatMiniProviderRecord(true);
      if (!foundProviderRecord) {
        throw new BadRequestException('微信扫码登录未配置，请先在后台系统设置中初始化并启用微信');
      }
      const providerRecord = foundProviderRecord;
      const policy = this.parseProviderPolicy(providerRecord);
      const socialProfile = await this.buildWechatMiniSocialProfile(
        payload,
          providerRecord,
          policy,
        );

      if (pendingBindState) {
        const binding = await this.bindAccountToUser(
          pendingBindState.userId,
          socialProfile,
          '',
          policy,
        );
        await this.markPendingBindStateCompleted(payload.state, binding.id);
        return {
          success: true,
          status: 'completed' as const,
          binding,
        };
      }

      if (!pendingLoginState) {
        throw new BadRequestException('扫码登录会话已过期，请重新发起登录');
      }

      const user = await this.findOrCreateUser(socialProfile, '', {
        clientId: pendingLoginState.clientId,
        redirectUri: pendingLoginState.redirectUri,
      }, policy, {
        autoCreateUnboundUser: true,
      });
      const tokens = await this.authService.issueTokensForUser({
        user,
        scopes: ['profile', 'email'],
      });
      const response = {
        ...tokens,
        user: this.userService.toApiUser(user),
      };

      await this.updatePendingLoginState(payload.state, {
        status: 'completed',
        authTicket: await this.createLoginTicket(response),
        auth: undefined,
        completedAt: new Date().toISOString(),
      });

      return {
        success: true,
        status: 'completed' as const,
        user: response.user,
      };
    } catch (error) {
      const message =
        error instanceof SocialBindRequiredError
          ? '该微信账号尚未绑定用户，请先在账号中心或联系管理员完成绑定'
          : error instanceof Error
            ? error.message
            : '微信扫码登录失败';

      const completedAt = new Date().toISOString();
      if (pendingLoginState) {
        await this.updatePendingLoginState(payload.state, {
          status: 'failed',
          error: message,
          completedAt,
        });
      } else if (pendingBindState) {
        await this.updatePendingBindState(payload.state, {
          status: 'failed',
          error: message,
          completedAt,
        });
      }

      if (error instanceof SocialBindRequiredError) {
        throw new BadRequestException(message);
      }

      throw error;
    }
  }

  async getLoginAuthorizationStatus(state: string) {
    const setting = await this.prismaService.systemSetting.findUnique({
      where: { key: this.buildLoginStateKey(state) },
    });

    if (!setting) {
      return { status: 'expired' as const };
    }

    try {
      const payload = JSON.parse(setting.value) as PendingLoginState;

      if (new Date(payload.expiresAt).getTime() <= Date.now()) {
        await this.prismaService.systemSetting.delete({
          where: { key: this.buildLoginStateKey(state) },
        });
        return { status: 'expired' as const };
      }

      return {
        status: payload.status ?? 'pending',
        provider: payload.provider,
        ticket: payload.authTicket ?? (
          payload.status === 'completed' && payload.auth
            ? await this.createLoginTicket(payload.auth)
            : null
        ),
        auth: null,
        error: payload.error ?? null,
        completedAt: payload.completedAt ?? null,
        scannedAt: payload.scannedAt ?? null,
      };
    } catch {
      return { status: 'expired' as const };
    }
  }

  private getProviderEndpoints(
    provider: string,
    providerRecord?: Partial<SocialProviderRuntimeConfig> | null,
  ): ProviderEndpoints {
    const config = PROVIDER_CONFIGS[provider];

    if (config) {
      return {
        ...config,
        authorizeUrl: providerRecord?.authUrl?.trim() || config.authorizeUrl,
        tokenUrl: providerRecord?.tokenUrl?.trim() || config.tokenUrl,
        userInfoUrl: providerRecord?.userInfoUrl?.trim() || config.userInfoUrl,
      };
    }

    const authorizeUrl = providerRecord?.authUrl?.trim();
    const tokenUrl = providerRecord?.tokenUrl?.trim();
    const userInfoUrl = providerRecord?.userInfoUrl?.trim();
    if (!authorizeUrl || !tokenUrl || !userInfoUrl) {
      throw new BadRequestException(`第三方登录 ${provider} 未配置授权、Token 或用户信息地址`);
    }

    return {
      authorizeUrl,
      tokenUrl,
      userInfoUrl,
      scope: 'openid profile email',
      tokenMethod: 'POST',
      tokenContentType: 'application/x-www-form-urlencoded',
      parseTokenResponse: (body) => {
        try {
          const data = JSON.parse(body) as {
            access_token?: string;
            accessToken?: string;
            openid?: string;
            open_id?: string;
            errcode?: number;
            errmsg?: string;
            error?: string;
            error_description?: string;
          };
          if (data.errcode || data.error) {
            throw new Error(data.errmsg ?? data.error_description ?? data.error ?? 'token error');
          }
          const accessToken = data.access_token ?? data.accessToken;
          if (!accessToken) {
            throw new Error('Failed to parse OAuth token response');
          }
          return { accessToken, openid: data.openid ?? data.open_id };
        } catch {
          const params = new URLSearchParams(body);
          const accessToken = params.get('access_token') ?? params.get('accessToken');
          if (!accessToken) {
            throw new Error('Failed to parse OAuth token response');
          }
          return { accessToken, openid: params.get('openid') ?? params.get('open_id') ?? undefined };
        }
      },
    };
  }

  async listBindings(userId: string) {
    const accounts = await this.prismaService.socialAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    return accounts.map((account) => this.toApiBinding(account));
  }

  private async createWechatMiniBindAuthorization(userId: string, returnTo?: string) {
    const foundProviderRecord = await this.getWechatMiniProviderRecord(true);
    if (!foundProviderRecord) {
      throw new BadRequestException('微信扫码绑定未配置，请先在后台系统设置中初始化并启用微信');
    }

    const providerRecord = foundProviderRecord;
    const state = await this.createPendingBindState(userId, 'wechat-mini', returnTo);
    const scene = this.buildWechatMiniScene(state);
    const miniProgramPath = this.buildWechatMiniPath(state, providerRecord);
    const fallback = this.buildWechatMiniQrFallback(state, scene, miniProgramPath);
    const { qrCodeUrl, qrMode } = await this.buildWechatMiniQrCodeUrl(
      scene,
      providerRecord,
      fallback.qrMode,
    );
    const qrContent = fallback.qrContent;

    return {
      authorizeUrl: qrContent,
      qrCodeUrl,
      state,
      miniProgramPath,
      scene,
      qrMode,
      qrContent,
      expiresIn: 10 * 60,
    };
  }

  async createBindAuthorization(
    userId: string,
    provider: string,
    returnTo?: string,
  ) {
    if (provider === 'wechat-mini') {
      return this.createWechatMiniBindAuthorization(userId, returnTo);
    }

    const csrfState = await this.createPendingBindState(userId, provider, returnTo);
    const authorization = await this.buildAuthorizePayload(
      provider,
      '/api/auth/callback',
      `${csrfState}|${provider}`,
    );

    return {
      authorizeUrl: authorization.authorizeUrl,
      qrCodeUrl: authorization.qrCodeUrl ?? null,
      state: csrfState,
    };
  }

  async unbind(userId: string, provider: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      include: { socialAccounts: true },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const account = user.socialAccounts.find((item) => item.provider === provider);

    if (!account) {
      throw new NotFoundException('第三方账号绑定关系不存在');
    }

    if (!user.passwordHash && user.socialAccounts.length <= 1) {
      throw new BadRequestException(
        '解绑前请先设置密码或绑定其他第三方账号',
      );
    }

    const storedProfile = this.parseStoredProfile(account.profile);
    const profile: SocialUserProfile = {
      provider: account.provider,
      providerUserId: account.providerUserId,
      email: typeof storedProfile.email === 'string' ? storedProfile.email : null,
      username: typeof storedProfile.username === 'string'
        ? storedProfile.username
        : `${account.provider}_${account.providerUserId.slice(0, 8)}`,
      avatar: typeof storedProfile.avatar === 'string' ? storedProfile.avatar : null,
    };
    const placeholderUser = await this.ensureSocialPlaceholderUser(profile);

    await this.prismaService.socialAccount.update({
      where: { id: account.id },
      data: { userId: placeholderUser.id },
    });

    return { success: true };
  }

  private getAggregatedSubType(providerName: string): string {
    const map: Record<string, string> = {
      agg_wechat: 'wx',
      agg_qq: 'qq',
      agg_alipay: 'alipay',
      agg_sina: 'sina',
      agg_baidu: 'baidu',
      agg_huawei: 'huawei',
      agg_xiaomi: 'xiaomi',
      agg_douyin: 'douyin',
      agg_bilibili: 'bilibili',
      agg_dingtalk: 'dingtalk',
      wechat: 'wx',
      qq: 'qq',
    };
    return map[providerName] ?? providerName.replace('agg_', '');
  }

  private async buildAggregatedAuthorizeRedirect(
    providerRecord: SocialProviderRuntimeConfig,
    providerName: string,
    callbackPath: string,
    state?: string,
  ) {
    const apiUrl = (providerRecord.apiUrl || 'https://u.cccyun.cc/').replace(/\/+$/, '');
    const subType = this.getAggregatedSubType(providerName);
    const redirectUri = this.resolveOAuthRedirectUri(providerRecord, callbackPath);

    const params = new URLSearchParams({
      act: 'login',
      appid: providerRecord.clientId,
      appkey: providerRecord.clientSecret,
      type: subType,
      redirect_uri: redirectUri,
    });
    if (state) params.set('state', state);

    const resp = await fetch(`${apiUrl}/connect.php?${params.toString()}`);
    const data = await resp.json() as { code: number; msg: string; url: string; qrcode?: string };

    if (data.code !== 0 || !data.url) {
      throw new BadRequestException(
        `聚合平台返回错误：${data.msg}（当前回调地址：${redirectUri}，请在聚合平台后台授权该回调域名并确认登录方式已开启、AppID/AppKey 正确）`,
      );
    }

    return data.url;
  }

  private async buildAggregatedAuthorizePayload(
    providerRecord: SocialProviderRuntimeConfig,
    providerName: string,
    callbackPath: string,
    state?: string,
  ): Promise<AuthorizationPayload> {
    const apiUrl = (providerRecord.apiUrl || 'https://u.cccyun.cc/').replace(/\/+$/, '');
    const subType = this.getAggregatedSubType(providerName);
    const redirectUri = this.resolveOAuthRedirectUri(providerRecord, callbackPath);

    const params = new URLSearchParams({
      act: 'login',
      appid: providerRecord.clientId,
      appkey: providerRecord.clientSecret,
      type: subType,
      redirect_uri: redirectUri,
    });
    if (state) params.set('state', state);

    const resp = await fetch(`${apiUrl}/connect.php?${params.toString()}`);
    const data = await resp.json() as { code: number; msg: string; url: string; qrcode?: string };

    if (data.code !== 0 || !data.url) {
      throw new BadRequestException(
        `聚合平台返回错误：${data.msg}（当前回调地址：${redirectUri}，请在聚合平台后台授权该回调域名并确认登录方式已开启、AppID/AppKey 正确）`,
      );
    }

    return {
      authorizeUrl: data.url,
      qrCodeUrl: this.normalizeProviderQrCode(data.qrcode, apiUrl),
    };
  }

  private normalizeProviderQrCode(qrcode: string | undefined, apiUrl: string) {
    const value = qrcode?.trim();
    if (!value) {
      return null;
    }

    if (value.startsWith('data:image/')) {
      return value;
    }

    if (/^[A-Za-z0-9+/=]+$/.test(value) && value.length > 100) {
      return `data:image/png;base64,${value}`;
    }

    const isImagePath = /\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(value);
    if (!isImagePath) {
      return null;
    }

    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    if (value.startsWith('//')) {
      return `https:${value}`;
    }

    if (value.startsWith('/')) {
      return `${apiUrl}${value}`;
    }

    return `${apiUrl}/${value.replace(/^\/+/, '')}`;
  }

  private async handleAggregatedCallback(
    providerRecord: SocialProviderRuntimeConfig,
    code: string,
  ): Promise<SocialUserProfile> {
    const apiUrl = (providerRecord.apiUrl || 'https://u.cccyun.cc/').replace(/\/+$/, '');

    const params = new URLSearchParams({
      act: 'callback',
      appid: providerRecord.clientId,
      appkey: providerRecord.clientSecret,
      code,
    });

    const resp = await fetch(`${apiUrl}/connect.php?${params.toString()}`);
    const data = await resp.json() as {
      code: number; msg: string; type: string;
      social_uid: string; access_token: string;
      nickname: string; faceimg: string; gender?: string;
    };

    if (data.code !== 0 || !data.social_uid) {
      throw new BadRequestException(`聚合登录获取用户信息失败：${data.msg}`);
    }

    const subType = this.getAggregatedSubType(providerRecord.name);
    const subTypeToProvider: Record<string, string> = {
      wx: 'wechat', qq: 'qq', alipay: 'alipay', sina: 'weibo',
      baidu: 'baidu', huawei: 'huawei', xiaomi: 'xiaomi',
      douyin: 'douyin', bilibili: 'bilibili', dingtalk: 'dingtalk',
    };
    const providerLabel = subTypeToProvider[subType] ?? subType;

    const policy = this.parseProviderPolicy(providerRecord);
    if (Object.keys(policy.fieldMapping).length > 0) {
      return this.buildMappedSocialProfile(providerLabel, data, policy.fieldMapping, {
        providerAppId: providerRecord.clientId,
        email: null,
      });
    }

    return {
      provider: providerLabel,
      providerUserId: data.social_uid,
      providerAppId: providerRecord.clientId,
      email: null,
      username: data.nickname || `${providerLabel}_${data.social_uid.slice(0, 8)}`,
      avatar: data.faceimg || null,
      rawProfile: data,
    };
  }

  async buildAuthorizeRedirect(provider: string, callbackPath: string, state?: string) {
    const payload = await this.buildAuthorizePayload(provider, callbackPath, state);
    return payload.authorizeUrl;
  }

  private async buildAuthorizePayload(provider: string, callbackPath: string, state?: string): Promise<AuthorizationPayload> {
    const foundProviderRecord = await this.prismaService.socialProvider.findUnique({
      where: { name: provider },
    });

    if (!foundProviderRecord) {
      throw new BadRequestException(`第三方登录 ${provider} 不存在，请在后台添加`);
    }

    const providerRecord = this.decryptProviderRecord(foundProviderRecord);

    if (!providerRecord.enabled) {
      throw new BadRequestException(`第三方登录 ${provider} 未启用，请在后台开启`);
    }

    if (!providerRecord.clientId || !providerRecord.clientSecret) {
      throw new BadRequestException(`第三方登录 ${provider} 配置不完整（缺少 AppID/Client ID 或密钥）`);
    }

    if (providerRecord.type === 'aggregated') {
      return this.buildAggregatedAuthorizePayload(providerRecord, provider, callbackPath, state);
    }

    const endpoints = this.getProviderEndpoints(provider, providerRecord);
    const redirectUri = this.resolveOAuthRedirectUri(providerRecord, callbackPath);
    const scopes = providerRecord.scopes
      ? JSON.parse(providerRecord.scopes) as string[]
      : [endpoints.scope];

    const params = new URLSearchParams({
      client_id: providerRecord.clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(provider === 'google' ? ' ' : ','),
      response_type: 'code',
    });

    if (state) {
      params.set('state', state);
    }

    // WeChat requires #wechat_redirect
    if (provider === 'wechat') {
      return { authorizeUrl: `${endpoints.authorizeUrl}?${params.toString()}#wechat_redirect` };
    }

    // QQ uses 'all' as display
    if (provider === 'qq') {
      params.set('display', 'page');
    }

    return { authorizeUrl: `${endpoints.authorizeUrl}?${params.toString()}` };
  }

  async handleCallback(
    provider: string,
    code: string,
    state?: string,
    appContext?: SocialLoginApplicationContext,
    securityContext?: SocialCallbackSecurityContext,
  ) {
    const foundProviderRecord = await this.prismaService.socialProvider.findUnique({
      where: { name: provider },
    });

    if (!foundProviderRecord) {
      throw new BadRequestException(`第三方登录 ${provider} 不存在`);
    }

    const providerRecord = this.decryptProviderRecord(foundProviderRecord);

    if (!providerRecord.enabled) {
      throw new BadRequestException(`第三方登录 ${provider} 未启用，请在后台开启`);
    }

    this.validateCallbackSecurity(providerRecord, securityContext);

    if (appContext?.clientId || appContext?.redirectUri) {
      await this.assertProviderAllowedForApplication(
        provider,
        appContext.clientId,
        appContext.redirectUri,
      );
    }

    const policy = this.parseProviderPolicy(providerRecord);

    // Aggregated login path
    if (providerRecord.type === 'aggregated') {
      const socialProfile = await this.handleAggregatedCallback(providerRecord, code);

      const pendingBindState = await this.consumePendingBindState(state);
      if (pendingBindState) {
        if (pendingBindState.provider !== provider || !pendingBindState.userId) {
          throw new BadRequestException('第三方绑定状态无效');
        }
        const binding = await this.bindAccountToUser(
          pendingBindState.userId,
          socialProfile,
          '',
          policy,
        );
        await this.markPendingBindStateCompleted(state, binding.id);
        return { mode: 'bind' as const, provider, returnTo: pendingBindState.returnTo, binding };
      }

      const pendingLoginState = await this.getPendingLoginState(state);
      const registrationContext = pendingLoginState
        ? {
            clientId: pendingLoginState.clientId,
            redirectUri: pendingLoginState.redirectUri,
          }
        : appContext;
      let user: User;
      try {
        user = await this.findOrCreateUser(
          socialProfile,
          '',
          registrationContext,
          policy,
        );
      } catch (error) {
        if (pendingLoginState) {
          const message =
            error instanceof SocialBindRequiredError
              ? '该第三方账号尚未绑定用户，请先在账号中心或联系管理员完成绑定'
              : error instanceof Error
                ? error.message
                : '第三方登录失败';
          await this.updatePendingLoginState(state, {
            status: 'failed',
            error: message,
            completedAt: new Date().toISOString(),
          });
          return { mode: 'qr_error' as const, provider, error: message };
        }

        throw error;
      }
      const tokens = await this.authService.issueTokensForUser({
        user, scopes: ['profile', 'email'],
      });
      const response = { ...tokens, user: this.userService.toApiUser(user) };

      if (pendingLoginState) {
        await this.updatePendingLoginState(state, {
          status: 'completed',
          authTicket: await this.createLoginTicket(response),
          auth: undefined,
          completedAt: new Date().toISOString(),
        });
        return { mode: 'qr_login' as const, provider };
      }

      return { mode: 'login' as const, ...response };
    }

    const endpoints = this.getProviderEndpoints(provider, providerRecord);
    const callbackPath = appContext?.clientId && appContext.redirectUri
      ? `/api/auth/callback?client_id=${encodeURIComponent(appContext.clientId)}&redirect_uri=${encodeURIComponent(appContext.redirectUri)}`
      : '/api/auth/callback';
    const redirectUri = this.resolveOAuthRedirectUri(providerRecord, callbackPath);

    // 1. Exchange code for access token
    const tokenResult = await this.exchangeCodeForToken(
      provider,
      endpoints,
      providerRecord.clientId,
      providerRecord.clientSecret,
      code,
      redirectUri,
    );

    // QQ requires a separate call to get openid
    let openid = tokenResult.openid;
    if (provider === 'qq' && !openid && endpoints.openidUrl) {
      const meResp = await fetch(`${endpoints.openidUrl}?access_token=${tokenResult.accessToken}`);
      const meBody = await meResp.text();
      // QQ returns a JSONP-like callback: callback( {"client_id":"...","openid":"..."} );
      const jsonMatch = meBody.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const meData = JSON.parse(jsonMatch[0]) as { openid?: string; error?: number; error_description?: string };
        if (meData.error) throw new Error(`QQ openid error: ${meData.error_description}`);
        openid = meData.openid;
      }
      if (!openid) throw new Error('Failed to get QQ openid');
    }

    // 2. Fetch user profile from provider
    const socialProfile = await this.fetchSocialProfile(
      provider,
      endpoints,
      tokenResult.accessToken,
      openid,
      providerRecord.clientId,
      providerRecord,
      policy,
    );

    const pendingBindState = await this.consumePendingBindState(state);
    const pendingLoginState = await this.getPendingLoginState(state);

    if (pendingBindState) {
      if (
        pendingBindState.provider !== provider ||
        !pendingBindState.userId
      ) {
        throw new BadRequestException('第三方绑定状态无效');
      }

      const binding = await this.bindAccountToUser(
        pendingBindState.userId,
        socialProfile,
        tokenResult.accessToken,
        policy,
      );
      await this.markPendingBindStateCompleted(state, binding.id);

      return {
        mode: 'bind' as const,
        provider,
        returnTo: pendingBindState.returnTo,
        binding,
      };
    }

    // 3. Find or create user in our system
    const registrationContext = pendingLoginState
      ? {
          clientId: pendingLoginState.clientId,
          redirectUri: pendingLoginState.redirectUri,
        }
      : appContext;
    let user: User;
    try {
      user = await this.findOrCreateUser(
        socialProfile,
        tokenResult.accessToken,
        registrationContext,
        policy,
      );
    } catch (error) {
      if (pendingLoginState) {
        const message =
          error instanceof SocialBindRequiredError
            ? '该第三方账号尚未绑定用户，请先在账号中心或联系管理员完成绑定'
            : error instanceof Error
              ? error.message
              : '第三方登录失败';
        await this.updatePendingLoginState(state, {
          status: 'failed',
          error: message,
          completedAt: new Date().toISOString(),
        });
        return { mode: 'qr_error' as const, provider, error: message };
      }

      throw error;
    }

    // 4. Issue SSO tokens
    const tokens = await this.authService.issueTokensForUser({
      user,
      scopes: ['profile', 'email'],
    });

    const response = {
      ...tokens,
      user: this.userService.toApiUser(user),
    };

    if (pendingLoginState) {
      await this.updatePendingLoginState(state, {
        status: 'completed',
        authTicket: await this.createLoginTicket(response),
        auth: undefined,
        completedAt: new Date().toISOString(),
      });
      return { mode: 'qr_login' as const, provider };
    }

    return {
      mode: 'login' as const,
      ...response,
    };
  }

  private async exchangeCodeForToken(
    provider: string,
    endpoints: ProviderEndpoints,
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; openid?: string }> {
    if (endpoints.tokenMethod === 'GET') {
      // WeChat & QQ use GET for token exchange
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      });

      // WeChat uses 'appid' and 'secret' instead of 'client_id' and 'client_secret'
      if (provider === 'wechat') {
        const wxParams = new URLSearchParams({
          appid: clientId,
          secret: clientSecret,
          code,
          grant_type: 'authorization_code',
        });
        const resp = await fetch(`${endpoints.tokenUrl}?${wxParams.toString()}`);
        const body = await resp.text();
        return endpoints.parseTokenResponse(body);
      }

      const resp = await fetch(`${endpoints.tokenUrl}?${params.toString()}`);
      const body = await resp.text();
      return endpoints.parseTokenResponse(body);
    }

    // GitHub & Google use POST
    if (provider === 'google') {
      const resp = await fetch(endpoints.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }).toString(),
      });
      const body = await resp.text();
      return endpoints.parseTokenResponse(body);
    }

    // GitHub
    const resp = await fetch(endpoints.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });
    const body = await resp.text();
    return endpoints.parseTokenResponse(body);
  }

  private async fetchSocialProfile(
    provider: string,
    endpoints: ProviderEndpoints,
    accessToken: string,
    openid?: string,
    clientId?: string,
    providerRecord?: Partial<SocialProviderRuntimeConfig>,
    policy = this.parseProviderPolicy(providerRecord),
  ): Promise<SocialUserProfile> {
    if (provider === 'github') {
      const resp = await fetch(endpoints.userInfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'Nexus-SSO',
        },
      });
      const data = await resp.json() as {
        id: number;
        login: string;
        name?: string | null;
        email: string | null;
        avatar_url: string | null;
      };

      // GitHub may not expose email; try the emails endpoint
      let email = data.email;
      if (!email && endpoints.userInfoEmailUrl) {
        const emailResp = await fetch(endpoints.userInfoEmailUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'User-Agent': 'Nexus-SSO',
          },
        });
        const emails = await emailResp.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = emails.find((e) => e.primary && e.verified);
        email = primary?.email ?? emails[0]?.email ?? null;
      }

      return {
        provider: 'github',
        providerUserId: String(data.id),
        providerAppId: clientId ?? null,
        email,
        username: data.login,
        displayName: data.name ?? data.login,
        avatar: data.avatar_url,
        rawProfile: data,
      };
    }

    if (provider === 'google') {
      const resp = await fetch(endpoints.userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await resp.json() as {
        sub: string;
        email: string;
        name: string;
        picture: string | null;
      };

      return {
        provider: 'google',
        providerUserId: data.sub,
        providerAppId: clientId ?? null,
        email: data.email,
        username: data.name || data.email.split('@')[0],
        displayName: data.name || data.email.split('@')[0],
        avatar: data.picture,
        rawProfile: data,
      };
    }

    if (provider === 'wechat') {
      if (!openid) throw new Error('WeChat requires openid from token response');
      const params = new URLSearchParams({
        access_token: accessToken,
        openid,
        lang: 'zh_CN',
      });
      const resp = await fetch(`${endpoints.userInfoUrl}?${params.toString()}`);
      const data = await resp.json() as {
        openid: string;
        nickname: string;
        headimgurl: string | null;
        unionid?: string;
        errcode?: number;
        errmsg?: string;
      };

      if (data.errcode) throw new Error(`WeChat user info error: ${data.errmsg}`);

      return {
        provider: 'wechat',
        providerUserId: data.unionid ?? data.openid,
        providerAppId: clientId ?? null,
        openid: data.openid,
        unionid: data.unionid ?? null,
        email: null,
        username: data.nickname || `wx_${data.openid.slice(0, 8)}`,
        displayName: data.nickname || `wx_${data.openid.slice(0, 8)}`,
        avatar: data.headimgurl,
        rawProfile: data,
      };
    }

    if (provider === 'qq') {
      if (!openid) throw new Error('QQ requires openid from token response');

      const params = new URLSearchParams({
        access_token: accessToken,
        oauth_consumer_key: clientId ?? '',
        openid,
      });
      const resp = await fetch(`${endpoints.userInfoUrl}?${params.toString()}`);
      const data = await resp.json() as {
        ret: number;
        msg: string;
        nickname: string;
        figureurl_qq: string | null;
      };

      if (data.ret !== 0) throw new Error(`QQ user info error: ${data.msg}`);

      return {
        provider: 'qq',
        providerUserId: openid,
        providerAppId: clientId ?? null,
        openid,
        email: null,
        username: data.nickname || `qq_${openid.slice(0, 8)}`,
        displayName: data.nickname || `qq_${openid.slice(0, 8)}`,
        avatar: data.figureurl_qq,
        rawProfile: data,
      };
    }

    const resp = await fetch(endpoints.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    const data = await resp.json() as Record<string, unknown>;
    return this.buildMappedSocialProfile(provider, data, policy.fieldMapping, {
      providerAppId: clientId ?? null,
      openid: openid ?? null,
    });
  }

  private async bindAccountToUser(
    userId: string,
    profile: SocialUserProfile,
    accessToken: string,
    policy = this.parseProviderPolicy(null),
  ) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const userProviderBinding = await this.prismaService.socialAccount.findFirst({
      where: {
        userId,
        provider: profile.provider,
      },
    });

    const socialAccount = await this.findSocialAccountByIdentity(profile, policy);
    const providerUserId = this.buildCanonicalProviderUserId(profile, policy);

    if (
      userProviderBinding &&
      userProviderBinding.providerUserId !== providerUserId
    ) {
      throw new BadRequestException(`当前账号已绑定 ${profile.provider}，请先解绑`);
    }

    if (socialAccount && socialAccount.userId !== userId) {
      const holderUser = await this.prismaService.user.findUnique({
        where: { id: socialAccount.userId },
      });
      const canTransferSocialPlaceholder =
        holderUser?.registrationSource === profile.provider;

      if (!canTransferSocialPlaceholder) {
        throw new BadRequestException('该第三方账号已绑定到其他用户，请先解绑');
      }

      const transferredAccount = await this.prismaService.socialAccount.update({
        where: { id: socialAccount.id },
        data: {
          ...this.buildSocialAccountData(profile, accessToken, policy),
          userId,
        },
      });
      return this.toApiBinding(transferredAccount);
    }

    if (socialAccount) {
      // Already bound to same user → update token
      const updatedAccount = await this.prismaService.socialAccount.update({
        where: { id: socialAccount.id },
        data: this.buildSocialAccountData(profile, accessToken, policy),
      });
      return this.toApiBinding(updatedAccount);
    }

    const createdAccount = await this.upsertSocialAccountForUser(
      userId,
      profile,
      accessToken,
      policy,
    );
    return this.toApiBinding(createdAccount);
  }

  private async resolveSocialRegistrationPolicy(
    appContext?: SocialLoginApplicationContext,
  ) {
    const authConfig = await this.authService.getAuthConfig();
    if (!appContext?.clientId && authConfig.publicApiEnabled) {
      return { allowed: true, registerClientId: null };
    }

    if (!appContext?.clientId || !appContext?.redirectUri) {
      return { allowed: false, registerClientId: null };
    }

    try {
      const { application } = await this.applicationService.assertRegistrationAllowed(
        appContext.clientId,
        appContext.redirectUri,
      );
      return { allowed: true, registerClientId: application.clientId };
    } catch {
      return { allowed: false, registerClientId: null };
    }
  }

  private async findOrCreateUser(
    profile: SocialUserProfile,
    accessToken: string,
    appContext?: SocialLoginApplicationContext,
    policy = this.parseProviderPolicy(null),
    options: SocialUserResolutionOptions = {},
  ) {
    const providerUserId = this.buildCanonicalProviderUserId(profile, policy);
    const socialAccount = await this.findSocialAccountByIdentity(profile, policy);

    if (socialAccount) {
      if (socialAccount.user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('用户账号已被禁用');
      }

      await this.upsertSocialAccountForUser(
        socialAccount.userId,
        profile,
        accessToken,
        policy,
        socialAccount.id,
      );

      return this.updateUserAfterSocialLogin(socialAccount.user, profile, policy);
    }

    // 2. Try to find existing user by email
    if (profile.email) {
      const existingUser = await this.prismaService.user.findUnique({
        where: { email: profile.email },
      });

      if (existingUser) {
        await this.upsertSocialAccountForUser(
          existingUser.id,
          profile,
          accessToken,
          policy,
        );
        return this.updateUserAfterSocialLogin(existingUser, profile, policy);
      }
    }

    // 3. Check fallback identity before registration policy; unbound social accounts
    // are restored to a placeholder user so they can still log in independently.
    const fallbackEmail = this.buildSocialFallbackEmail(
      profile.provider,
      providerUserId,
    );
    const legacyFallbackEmail = this.buildSocialFallbackEmail(
      profile.provider,
      this.normalizeProviderUserId(profile.providerUserId),
    );
    const existingByFallback = await this.prismaService.user.findFirst({
      where: {
        email: {
          in: fallbackEmail === legacyFallbackEmail
            ? [fallbackEmail]
            : [fallbackEmail, legacyFallbackEmail],
        },
      },
    });
    if (existingByFallback) {
      await this.upsertSocialAccountForUser(
        existingByFallback.id,
        profile,
        accessToken,
        policy,
      );
      return this.updateUserAfterSocialLogin(existingByFallback, profile, policy);
    }

    // 4. Check whether global or current OAuth application registration allows creating a user.
    // WeChat Mini Program scan login can be configured as a pure identity login:
    // verified WeChat identity creates a standalone SSO user without manual binding.
    const registrationPolicy = options.autoCreateUnboundUser
      ? { allowed: true, registerClientId: appContext?.clientId ?? null }
      : await this.resolveSocialRegistrationPolicy(appContext);
    if (!registrationPolicy.allowed) {
      throw new SocialBindRequiredError(profile);
    }

    // 5. Create new user
    const user = await this.prismaService.user.create({
      data: {
        email: profile.email ?? fallbackEmail,
        username: profile.username,
        displayName: profile.displayName ?? profile.username,
        avatar: profile.avatar,
        emailVerified: !!profile.email,
        status: UserStatus.ACTIVE,
        registrationSource: profile.provider,
        registerClientId: registrationPolicy.registerClientId,
      },
    });

    // Create social account link
    await this.upsertSocialAccountForUser(user.id, profile, accessToken, policy);

    return user;
  }

  /**
   * Store a social profile temporarily for "bind existing account" flow.
   * Returns a state token that the frontend uses to reference this pending bind.
   */
  async createPendingSocialBind(profile: SocialUserProfile): Promise<string> {
    const state = randomBytes(24).toString('base64url');
    const key = `pending_social_bind:${state}`;
    const payload = {
      ...profile,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };

    await this.prismaService.systemSetting.create({
      data: {
        key,
        value: JSON.stringify(payload),
      },
    });

    return state;
  }

  /**
   * Bind a pending social profile to an existing account after credential verification.
   * Returns session tokens for the bound user.
   */
  async bindExistingAccount(state: string, username: string, password: string) {
    const key = `pending_social_bind:${state}`;
    const setting = await this.prismaService.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      throw new BadRequestException('绑定凭证已过期或无效，请重新扫码登录');
    }

    let profile: SocialUserProfile & { expiresAt: string };
    try {
      profile = JSON.parse(setting.value);
    } catch {
      throw new BadRequestException('绑定凭证已损坏，请重新扫码登录');
    }

    if (new Date(profile.expiresAt).getTime() <= Date.now()) {
      await this.prismaService.systemSetting.delete({ where: { key } });
      throw new BadRequestException('绑定凭证已过期，请重新扫码登录');
    }

    // Find user by username or email
    const user = await this.prismaService.user.findFirst({
      where: {
        OR: [
          { username },
          { email: username },
        ],
      },
    });

    if (!user?.passwordHash) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('用户账号已被禁用');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    // Check if this social account is already bound to another user
    const existingAccount = await this.prismaService.socialAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
        },
      },
    });

    if (existingAccount && existingAccount.userId !== user.id) {
      // Allow transfer if the current holder is a social-registered user
      const holderUser = await this.prismaService.user.findUnique({
        where: { id: existingAccount.userId },
      });
      const canTransfer = holderUser?.registrationSource === profile.provider;

      if (!canTransfer) {
        throw new BadRequestException('该第三方账号已绑定其他用户');
      }

      // Transfer: delete old binding, create new one
      await this.prismaService.socialAccount.delete({
        where: { id: existingAccount.id },
      });
    }

    // If already bound to this user, just return tokens
    if (existingAccount && existingAccount.userId === user.id) {
      await this.prismaService.systemSetting.delete({ where: { key } });
      const tokens = await this.authService.issueTokensForUser({
        user,
        scopes: ['profile', 'email'],
      });
      return { ...tokens, user: this.userService.toApiUser(user) };
    }

    // Bind social account to user
    await this.prismaService.socialAccount.create({
      data: {
        userId: user.id,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        accessToken: '',
        profile: JSON.stringify(profile),
      },
    });

    // Clean up pending entry
    await this.prismaService.systemSetting.delete({ where: { key } });

    const tokens = await this.authService.issueTokensForUser({
      user,
      scopes: ['profile', 'email'],
    });
    return { ...tokens, user: this.userService.toApiUser(user) };
  }

  /**
   * Transfer social binding from another user to the current user.
   * The source user must be a social-registered user (registrationSource matches provider).
   */
  private normalizeSocialRegistrationProvider(source?: string | null) {
    const provider = source?.trim().toLowerCase();
    if (!provider || ['admin', 'register', 'public-api', 'setup', 'system'].includes(provider)) {
      return null;
    }
    return provider;
  }

  private extractProviderUserIdFromSocialEmail(provider: string, email?: string | null) {
    const prefix = `${provider}_`;
    const suffix = '@social.local';

    if (!email?.startsWith(prefix) || !email.endsWith(suffix)) {
      return null;
    }

    return email.slice(prefix.length, -suffix.length);
  }

  async transferSocialBinding(
    currentUserId: string,
    provider: string | undefined,
    targetUsername: string,
    targetPassword: string,
  ) {
    const currentUser = await this.prismaService.user.findUnique({
      where: { id: currentUserId },
      include: { socialAccounts: true },
    });

    if (!currentUser) {
      throw new NotFoundException('当前用户不存在');
    }

    const requestedProvider = provider?.trim() || undefined;
    const directBinding = requestedProvider
      ? currentUser.socialAccounts.find((item) => item.provider === requestedProvider)
      : currentUser.socialAccounts[0];
    const inferredProvider =
      directBinding?.provider ??
      requestedProvider ??
      this.normalizeSocialRegistrationProvider(currentUser.registrationSource);
    const inferredProviderUserId = inferredProvider
      ? this.extractProviderUserIdFromSocialEmail(inferredProvider, currentUser.email)
      : null;

    let sourceBinding = directBinding ?? null;
    if (!sourceBinding && inferredProvider && inferredProviderUserId) {
      const existingBinding = await this.prismaService.socialAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: inferredProvider,
            providerUserId: inferredProviderUserId,
          },
        },
      });

      if (existingBinding && existingBinding.userId !== currentUserId) {
        throw new BadRequestException('该第三方账号已绑定到其他用户，请直接使用第三方登录或目标账号登录');
      }

      sourceBinding = existingBinding;
    }

    if (!inferredProvider || (!sourceBinding && !inferredProviderUserId)) {
      throw new BadRequestException('当前账号没有可绑定的第三方登录信息');
    }

    const targetUser = await this.prismaService.user.findFirst({
      where: {
        OR: [
          { username: targetUsername },
          { email: targetUsername },
        ],
      },
    });

    if (!targetUser) {
      throw new UnauthorizedException('目标账号不存在');
    }

    if (targetUser.id === currentUserId) {
      throw new BadRequestException('不能绑定到当前账号');
    }

    if (!targetUser.passwordHash) {
      throw new UnauthorizedException('目标账号未设置密码');
    }

    if (targetUser.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('目标账号已被禁用');
    }

    const passwordMatches = await bcrypt.compare(targetPassword, targetUser.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const targetProviderConflict = await this.prismaService.socialAccount.findFirst({
      where: {
        userId: targetUser.id,
        provider: inferredProvider,
        ...(sourceBinding ? { id: { not: sourceBinding.id } } : {}),
      },
    });

    if (targetProviderConflict) {
      throw new BadRequestException(`目标账号已绑定了 ${inferredProvider}，请先解绑`);
    }

    if (sourceBinding) {
      await this.prismaService.socialAccount.update({
        where: { id: sourceBinding.id },
        data: { userId: targetUser.id },
      });
    } else {
      await this.prismaService.socialAccount.create({
        data: {
          userId: targetUser.id,
          provider: inferredProvider,
          providerUserId: inferredProviderUserId!,
          accessToken: '',
          profile: '{}',
        },
      });
    }

    const tokens = await this.authService.issueTokensForUser({
      user: targetUser,
      scopes: ['profile', 'email'],
    });

    return {
      ...tokens,
      user: this.userService.toApiUser(targetUser),
    };
  }
}
