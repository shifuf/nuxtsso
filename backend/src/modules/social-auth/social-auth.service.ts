import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { UserService } from '../user/user.service';

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
  email: string | null;
  username: string;
  avatar: string | null;
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
  error?: string;
  completedAt?: string;
  scannedAt?: string;
}

interface AuthorizationPayload {
  authorizeUrl: string;
  qrCodeUrl?: string | null;
}

const SOCIAL_BIND_STATE_PREFIX = 'social-bind-state:';
const SOCIAL_LOGIN_STATE_PREFIX = 'social-login-state:';

@Injectable()
export class SocialAuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

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

  private buildBindStateKey(state: string) {
    return `${SOCIAL_BIND_STATE_PREFIX}${state}`;
  }

  private buildLoginStateKey(state: string) {
    return `${SOCIAL_LOGIN_STATE_PREFIX}${state}`;
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
    providerUserId: string;
    profile: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const profile = this.parseStoredProfile(account.profile);

    return {
      id: account.id,
      provider: account.provider,
      providerUserId: account.providerUserId,
      username:
        typeof profile.username === 'string' ? profile.username : null,
      email: typeof profile.email === 'string' ? profile.email : null,
      avatar: typeof profile.avatar === 'string' ? profile.avatar : null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
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
  ) {
    const state = randomBytes(24).toString('base64url');
    const payload: PendingLoginState = {
      provider,
      clientId: clientId ?? null,
      redirectUri: redirectUri ?? null,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      status: 'pending',
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
        auth: payload.auth ?? null,
        error: payload.error ?? null,
        completedAt: payload.completedAt ?? null,
        scannedAt: payload.scannedAt ?? null,
      };
    } catch {
      return { status: 'expired' as const };
    }
  }

  private getProviderEndpoints(provider: string): ProviderEndpoints {
    const config = PROVIDER_CONFIGS[provider];
    if (!config) {
      throw new BadRequestException(`不支持的第三方登录方式：${provider}`);
    }
    return config;
  }

  async listBindings(userId: string) {
    const accounts = await this.prismaService.socialAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    return accounts.map((account) => this.toApiBinding(account));
  }

  async createBindAuthorization(
    userId: string,
    provider: string,
    returnTo?: string,
  ) {
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

    await this.prismaService.socialAccount.delete({
      where: { id: account.id },
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
    providerRecord: { clientId: string; clientSecret: string; apiUrl: string | null },
    providerName: string,
    callbackPath: string,
    state?: string,
  ) {
    const apiUrl = (providerRecord.apiUrl || 'https://u.cccyun.cc/').replace(/\/+$/, '');
    const subType = this.getAggregatedSubType(providerName);
    const redirectUri = `${this.getOAuthCallbackBaseUrl()}${callbackPath}`;

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
    providerRecord: { clientId: string; clientSecret: string; apiUrl: string | null },
    providerName: string,
    callbackPath: string,
    state?: string,
  ): Promise<AuthorizationPayload> {
    const apiUrl = (providerRecord.apiUrl || 'https://u.cccyun.cc/').replace(/\/+$/, '');
    const subType = this.getAggregatedSubType(providerName);
    const redirectUri = `${this.getOAuthCallbackBaseUrl()}${callbackPath}`;

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
    providerRecord: { name: string; clientId: string; clientSecret: string; apiUrl: string | null },
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

    return {
      provider: providerLabel,
      providerUserId: data.social_uid,
      email: null,
      username: data.nickname || `${providerLabel}_${data.social_uid.slice(0, 8)}`,
      avatar: data.faceimg || null,
    };
  }

  async buildAuthorizeRedirect(provider: string, callbackPath: string, state?: string) {
    const payload = await this.buildAuthorizePayload(provider, callbackPath, state);
    return payload.authorizeUrl;
  }

  private async buildAuthorizePayload(provider: string, callbackPath: string, state?: string): Promise<AuthorizationPayload> {
    const providerRecord = await this.prismaService.socialProvider.findUnique({
      where: { name: provider },
    });

    if (!providerRecord) {
      throw new BadRequestException(`第三方登录 ${provider} 不存在，请在后台添加`);
    }

    if (!providerRecord.enabled) {
      throw new BadRequestException(`第三方登录 ${provider} 未启用，请在后台开启`);
    }

    if (!providerRecord.clientId || !providerRecord.clientSecret) {
      throw new BadRequestException(`第三方登录 ${provider} 配置不完整（缺少 AppID/Client ID 或密钥）`);
    }

    if (providerRecord.type === 'aggregated') {
      return this.buildAggregatedAuthorizePayload(providerRecord, provider, callbackPath, state);
    }

    const endpoints = this.getProviderEndpoints(provider);
    const redirectUri = `${this.getOAuthCallbackBaseUrl()}${callbackPath}`;
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

  async handleCallback(provider: string, code: string, state?: string) {
    const providerRecord = await this.prismaService.socialProvider.findUnique({
      where: { name: provider },
    });

    if (!providerRecord) {
      throw new BadRequestException(`第三方登录 ${provider} 不存在`);
    }

    if (!providerRecord.enabled) {
      throw new BadRequestException(`第三方登录 ${provider} 未启用，请在后台开启`);
    }

    // Aggregated login path
    if (providerRecord.type === 'aggregated') {
      const socialProfile = await this.handleAggregatedCallback(providerRecord, code);

      const pendingBindState = await this.consumePendingBindState(state);
      if (pendingBindState) {
        if (pendingBindState.provider !== provider || !pendingBindState.userId) {
          throw new BadRequestException('第三方绑定状态无效');
        }
        const binding = await this.bindAccountToUser(pendingBindState.userId, socialProfile, '');
        await this.markPendingBindStateCompleted(state, binding.id);
        return { mode: 'bind' as const, provider, returnTo: pendingBindState.returnTo, binding };
      }

      const pendingLoginState = await this.getPendingLoginState(state);
      let user: Awaited<ReturnType<typeof this.findOrCreateUser>>;
      try {
        user = await this.findOrCreateUser(socialProfile, '');
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
          auth: response,
          completedAt: new Date().toISOString(),
        });
        return { mode: 'qr_login' as const, provider };
      }

      return { mode: 'login' as const, ...response };
    }

    const endpoints = this.getProviderEndpoints(provider);
    const redirectUri = `${this.getOAuthCallbackBaseUrl()}/api/auth/callback`;

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
    let user: Awaited<ReturnType<typeof this.findOrCreateUser>>;
    try {
      user = await this.findOrCreateUser(socialProfile, tokenResult.accessToken);
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
        auth: response,
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
        email,
        username: data.login,
        avatar: data.avatar_url,
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
        email: data.email,
        username: data.name || data.email.split('@')[0],
        avatar: data.picture,
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
        email: null,
        username: data.nickname || `wx_${data.openid.slice(0, 8)}`,
        avatar: data.headimgurl,
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
        email: null,
        username: data.nickname || `qq_${openid.slice(0, 8)}`,
        avatar: data.figureurl_qq,
      };
    }

    throw new BadRequestException(`不支持的第三方登录方式：${provider}`);
  }

  private async bindAccountToUser(
    userId: string,
    profile: SocialUserProfile,
    accessToken: string,
  ) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const socialAccount = await this.prismaService.socialAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
        },
      },
    });

    if (socialAccount && socialAccount.userId !== userId) {
      throw new BadRequestException('该第三方账号已绑定到其他用户，请先解绑');
    }

    if (socialAccount) {
      // Already bound to same user → update token
      const updatedAccount = await this.prismaService.socialAccount.update({
        where: { id: socialAccount.id },
        data: {
          accessToken,
          profile: JSON.stringify(profile),
        },
      });
      return this.toApiBinding(updatedAccount);
    }

    // New binding
    const createdAccount = await this.prismaService.socialAccount.create({
      data: {
        userId,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        accessToken,
        profile: JSON.stringify(profile),
      },
    });
    return this.toApiBinding(createdAccount);
  }

  private async findOrCreateUser(
    profile: SocialUserProfile,
    accessToken: string,
  ) {
    // 1. Check if social account already exists
    const socialAccount = await this.prismaService.socialAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
        },
      },
      include: { user: true },
    });

    if (socialAccount) {
      if (socialAccount.user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('用户账号已被禁用');
      }

      // Update access token
      await this.prismaService.socialAccount.update({
        where: { id: socialAccount.id },
        data: {
          accessToken,
          profile: JSON.stringify(profile),
        },
      });

      return socialAccount.user;
    }

    // 2. Try to find existing user by email
    if (profile.email) {
      const existingUser = await this.prismaService.user.findUnique({
        where: { email: profile.email },
      });

      if (existingUser) {
        // Link social account to existing user
        await this.prismaService.socialAccount.create({
          data: {
            userId: existingUser.id,
            provider: profile.provider,
            providerUserId: profile.providerUserId,
            accessToken,
            profile: JSON.stringify(profile),
          },
        });
        return existingUser;
      }
    }

    // 3. Check if open registration is enabled before creating new user
    const authConfig = await this.authService.getAuthConfig();
    if (!authConfig.publicApiEnabled) {
      throw new SocialBindRequiredError(profile);
    }

    // 4. Check fallback email before creating (handles unbind+re-login for providers without email)
    const fallbackEmail = profile.email ?? `${profile.provider}_${profile.providerUserId}@social.local`;
    if (!profile.email) {
      const existingByFallback = await this.prismaService.user.findUnique({
        where: { email: fallbackEmail },
      });
      if (existingByFallback) {
        await this.prismaService.socialAccount.create({
          data: {
            userId: existingByFallback.id,
            provider: profile.provider,
            providerUserId: profile.providerUserId,
            accessToken,
            profile: JSON.stringify(profile),
          },
        });
        return existingByFallback;
      }
    }

    // 5. Create new user
    const user = await this.prismaService.user.create({
      data: {
        email: fallbackEmail,
        username: profile.username,
        avatar: profile.avatar,
        emailVerified: !!profile.email,
        status: UserStatus.ACTIVE,
        registrationSource: profile.provider,
      },
    });

    // Create social account link
    await this.prismaService.socialAccount.create({
      data: {
        userId: user.id,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        accessToken,
        profile: JSON.stringify(profile),
      },
    });

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
  async transferSocialBinding(currentUserId: string, provider: string, targetUsername: string, targetPassword: string) {
    // Find the social account by provider — could belong to current user or another
    const socialAccount = await this.prismaService.socialAccount.findFirst({
      where: { provider },
      include: { user: true },
    });

    if (!socialAccount) {
      throw new BadRequestException(`没有找到绑定的 ${provider} 账号`);
    }

    // Check if current user already has this provider bound
    const currentUserBinding = await this.prismaService.socialAccount.findFirst({
      where: { userId: currentUserId, provider },
    });

    if (currentUserBinding) {
      throw new BadRequestException(`当前账号已绑定 ${provider}`);
    }

    // Verify the target account (the account to receive the social binding)
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

    // Case 1: Social account belongs to current user (social-registered user giving away their binding)
    // → transfer to the target account
    if (socialAccount.userId === currentUserId) {
      await this.prismaService.socialAccount.update({
        where: { id: socialAccount.id },
        data: { userId: targetUser.id },
      });
      return { success: true, message: `${provider} 已绑定到目标账号` };
    }

    // Case 2: Social account belongs to another user — check if it's transferable
    const sourceUser = socialAccount.user;
    const canTransfer = sourceUser.registrationSource === provider;

    if (!canTransfer) {
      throw new BadRequestException('该第三方账号已绑定其他用户');
    }

    // Target user must be the current user (regular user claiming a social binding)
    if (targetUser.id !== currentUserId) {
      throw new BadRequestException('只能绑定到当前登录的账号');
    }

    // Delete the old binding and create a new one for the current user
    await this.prismaService.socialAccount.delete({
      where: { id: socialAccount.id },
    });

    await this.prismaService.socialAccount.create({
      data: {
        userId: currentUserId,
        provider,
        providerUserId: socialAccount.providerUserId,
        accessToken: socialAccount.accessToken,
        profile: socialAccount.profile,
      },
    });

    return { success: true, message: `${provider} 绑定成功` };
  }
}
