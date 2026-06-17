import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { SecretService } from '../../common/security/secret.service';
import { PrismaService } from '../../database/prisma.service';
import {
  parseStringArray,
  toJsonString,
} from '../../common/utils/json.util';

export class UpdateSocialProviderDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientSecret?: string;

  @IsOptional()
  @IsString()
  apiUrl?: string;

  @IsOptional()
  @Transform(({ value }) => emptyStringToUndefined(value))
  @IsString()
  redirectUri?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @Transform(({ value }) => emptyStringToUndefined(value))
  @IsUrl({ require_tld: false, require_protocol: true })
  authUrl?: string;

  @IsOptional()
  @Transform(({ value }) => emptyStringToUndefined(value))
  @IsUrl({ require_tld: false, require_protocol: true })
  tokenUrl?: string;

  @IsOptional()
  @Transform(({ value }) => emptyStringToUndefined(value))
  @IsUrl({ require_tld: false, require_protocol: true })
  userInfoUrl?: string;

  @IsOptional()
  @IsString()
  fieldMapping?: string;

  @IsOptional()
  @IsString()
  signatureSecret?: string;

  @IsOptional()
  @IsString()
  ipWhitelist?: string;

  @IsOptional()
  @IsIn([
    'unionid_or_app_openid',
    'unionid_only',
    'app_openid',
    'provider_user_id',
  ])
  identityStrategy?: string;

  @IsOptional()
  @IsIn(['fill_missing', 'every_login', 'registration_only'])
  profileSyncMode?: string;

  @IsOptional()
  @IsBoolean()
  miniProgramUseDynamicCode?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  miniProgramSubmitFields?: string[];
}

function emptyStringToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function isSqliteDeleteIoError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_IOERR_DELETE'
  );
}

export class CreateSocialProviderDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  apiUrl?: string;
}

const WECHAT_PROVIDER_NAMES = ['wechat', 'wechat-aggregated', 'wechat-mini'];

@Injectable()
export class SocialProviderService implements OnModuleInit {
  private readonly logger = new Logger(SocialProviderService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly secretService: SecretService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaults();
  }

  private async ensureDefaults() {
    const defaults = [
      { name: 'github', type: 'oauth' },
      { name: 'google', type: 'oauth' },
      { name: 'wechat', type: 'oauth' },
      { name: 'wechat-aggregated', type: 'aggregated' },
      { name: 'qq', type: 'oauth' },
      { name: 'wechat-mini', type: 'wechat-mini' },
    ];

    try {
      const existing = await this.prismaService.socialProvider.findMany({
        where: { name: { in: defaults.map((item) => item.name) } },
        select: { name: true },
      });
      const existingNames = new Set(existing.map((item) => item.name));

      for (const provider of defaults) {
        if (existingNames.has(provider.name)) {
          continue;
        }

        try {
          await this.prismaService.socialProvider.create({
            data: provider,
          });
        } catch (error) {
          if (isSqliteDeleteIoError(error)) {
            this.logger.warn(
              'Skipped creating missing default social providers because SQLite write access is unavailable.',
            );
            return;
          }
          throw error;
        }
      }

      await this.migrateLegacyWechatAggregatedProvider(existingNames);

      this.logger.log(`Ensured ${defaults.length} default social providers`);
    } catch (error) {
      if (isSqliteDeleteIoError(error)) {
        this.logger.warn(
          'Skipped default social provider initialization because SQLite database access is unstable on this machine.',
        );
        return;
      }
      throw error;
    }
  }

  private toApi(provider: {
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
  }) {
    return {
      name: provider.name,
      type: provider.type as 'oauth' | 'aggregated' | 'wechat-mini',
      enabled: provider.enabled,
      clientId: provider.clientId,
      clientSecret: this.secretService.mask(
        this.secretService.decryptMaybe(provider.clientSecret),
      ),
      apiUrl: provider.apiUrl ?? '',
      redirectUri: provider.redirectUri ?? '',
      scopes: provider.scopes ? parseStringArray(provider.scopes) : [],
      authUrl: provider.authUrl ?? '',
      tokenUrl: provider.tokenUrl ?? '',
      userInfoUrl: provider.userInfoUrl ?? '',
      fieldMapping: provider.fieldMapping ?? '',
      signatureSecret: this.secretService.mask(
        this.secretService.decryptMaybe(provider.signatureSecret),
      ),
      ipWhitelist: provider.ipWhitelist ?? '',
      identityStrategy: provider.identityStrategy,
      profileSyncMode: provider.profileSyncMode,
      miniProgramUseDynamicCode: provider.miniProgramUseDynamicCode,
      miniProgramSubmitFields: provider.miniProgramSubmitFields
        ? parseStringArray(provider.miniProgramSubmitFields)
        : ['jsCode'],
    };
  }

  private decryptProviderSecret(value?: string | null) {
    return this.secretService.decryptMaybe(value).trim();
  }

  private async migrateLegacyWechatAggregatedProvider(existingNames: Set<string>) {
    if (existingNames.has('wechat-aggregated')) {
      return;
    }

    const legacyWechat = await this.prismaService.socialProvider.findUnique({
      where: { name: 'wechat' },
    });
    const wechatAggregated = await this.prismaService.socialProvider.findUnique({
      where: { name: 'wechat-aggregated' },
    });

    if (!legacyWechat || wechatAggregated || legacyWechat.type !== 'aggregated') {
      return;
    }

    await this.prismaService.socialProvider.update({
      where: { name: 'wechat-aggregated' },
      data: {
        enabled: legacyWechat.enabled,
        clientId: legacyWechat.clientId,
        clientSecret: legacyWechat.clientSecret,
        apiUrl: legacyWechat.apiUrl,
        redirectUri: legacyWechat.redirectUri,
        scopes: legacyWechat.scopes,
        authUrl: legacyWechat.authUrl,
        tokenUrl: legacyWechat.tokenUrl,
        userInfoUrl: legacyWechat.userInfoUrl,
        fieldMapping: legacyWechat.fieldMapping,
        signatureSecret: legacyWechat.signatureSecret,
        ipWhitelist: legacyWechat.ipWhitelist,
        identityStrategy: 'unionid_or_app_openid',
        profileSyncMode: 'fill_missing',
      },
    });

    if (legacyWechat.enabled) {
      await this.prismaService.socialProvider.update({
        where: { name: 'wechat' },
        data: { enabled: false },
      });
    }
  }

  async initDefaults() {
    await this.ensureDefaults();
    return this.listAll();
  }

  async listAll() {
    const providers = await this.prismaService.socialProvider.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return providers.map((p) => this.toApi(p));
  }

  async getByName(name: string) {
    const provider = await this.prismaService.socialProvider.findUnique({
      where: { name },
    });
    if (!provider) {
      throw new NotFoundException(`Social provider "${name}" not found`);
    }
    return this.toApi(provider);
  }

  async getRawByName(name: string) {
    const provider = await this.prismaService.socialProvider.findUnique({
      where: { name },
    });
    if (!provider) {
      throw new NotFoundException(`Social provider "${name}" not found`);
    }
    return provider;
  }

  async create(dto: CreateSocialProviderDto) {
    const existing = await this.prismaService.socialProvider.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new BadRequestException('该第三方登录已存在');
    }
    const provider = await this.prismaService.socialProvider.create({
      data: {
        name: dto.name,
        type: dto.type ?? 'oauth',
        apiUrl: dto.apiUrl ?? '',
      },
    });
    return this.toApi(provider);
  }

  private isWechatMiniProvider(name: string, type?: string | null) {
    return name === 'wechat-mini' || type === 'wechat-mini';
  }

  private isWechatProviderName(name: string) {
    return WECHAT_PROVIDER_NAMES.includes(name);
  }

  private async validateWechatMiniCredentials(appId: string, appSecret: string) {
    const params = new URLSearchParams({
      grant_type: 'client_credential',
      appid: appId,
      secret: appSecret,
    });
    let data: {
      access_token?: string;
      errcode?: number;
      errmsg?: string;
    };

    try {
      const response = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${params.toString()}`);
      data = await response.json() as typeof data;

      if (!response.ok || data.errcode || !data.access_token) {
        throw new BadRequestException(
          `微信小程序 AppID/AppSecret 校验失败：${data.errmsg ?? response.statusText}`,
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : '网络请求失败';
      throw new BadRequestException(`微信小程序 AppID/AppSecret 校验失败：${message}`);
    }
  }

  async update(name: string, dto: UpdateSocialProviderDto) {
    const existing = await this.prismaService.socialProvider.findUnique({
      where: { name },
    });
    if (!existing) {
      throw new NotFoundException(`Social provider "${name}" not found`);
    }

    const wantEnabled = dto.enabled ?? existing.enabled;
    const providerType =
      name === 'wechat-aggregated'
        ? 'aggregated'
        : name === 'wechat-mini'
          ? 'wechat-mini'
          : dto.type ?? existing.type;
    if (providerType === 'wechat-mini' && name !== 'wechat-mini') {
      throw new BadRequestException('自建小程序来源仅支持微信');
    }
    const isWechatMini = this.isWechatMiniProvider(name, providerType);
    const isWechatProvider = this.isWechatProviderName(name);
    const clientId = dto.clientId ?? existing.clientId;
    const existingClientSecret = this.decryptProviderSecret(existing.clientSecret);
    const clientSecret =
      dto.clientSecret !== undefined && !this.secretService.isMasked(dto.clientSecret)
        ? dto.clientSecret.trim()
        : existingClientSecret;
    const clientIdChanged =
      dto.clientId !== undefined && dto.clientId.trim() !== existing.clientId.trim();
    const clientSecretChanged =
      dto.clientSecret !== undefined &&
      !this.secretService.isMasked(dto.clientSecret) &&
      dto.clientSecret.trim() !== existingClientSecret;
    if (wantEnabled && (!clientId.trim() || !clientSecret.trim())) {
      throw new BadRequestException(
        isWechatMini
          ? '启用前请先填写小程序 AppID 和 AppSecret'
          : '启用前请先填写 Client ID 和 Client Secret',
      );
    }

    const shouldValidateWechatMini =
      wantEnabled &&
      isWechatMini &&
      (
        !existing.enabled ||
        clientIdChanged ||
        clientSecretChanged ||
        (dto.type === 'wechat-mini' && existing.type !== 'wechat-mini')
      );

    if (shouldValidateWechatMini) {
      await this.validateWechatMiniCredentials(clientId.trim(), clientSecret);
    }

    const provider = await this.prismaService.$transaction(async (tx) => {
      const updated = await tx.socialProvider.update({
        where: { name },
        data: {
          type: providerType,
          enabled: dto.enabled,
          clientId: dto.clientId,
          clientSecret: this.secretService.preserveOrEncrypt(
            dto.clientSecret,
            existing.clientSecret,
          ),
          apiUrl: dto.apiUrl,
          redirectUri: dto.redirectUri,
          scopes:
            isWechatMini
              ? toJsonString([])
              : dto.scopes === undefined
                ? undefined
                : toJsonString(dto.scopes),
          authUrl: dto.authUrl,
          tokenUrl: dto.tokenUrl,
          userInfoUrl: dto.userInfoUrl,
          fieldMapping: dto.fieldMapping,
          signatureSecret: this.secretService.preserveOrEncrypt(
            dto.signatureSecret,
            existing.signatureSecret,
          ),
          ipWhitelist: dto.ipWhitelist,
          identityStrategy: isWechatProvider ? 'unionid_or_app_openid' : dto.identityStrategy,
          profileSyncMode: isWechatProvider ? 'fill_missing' : dto.profileSyncMode,
          miniProgramUseDynamicCode: isWechatMini ? true : dto.miniProgramUseDynamicCode,
          miniProgramSubmitFields:
            isWechatMini
              ? toJsonString(['jsCode'])
              : dto.miniProgramSubmitFields === undefined
                ? undefined
                : toJsonString(dto.miniProgramSubmitFields),
        },
      });

      if (wantEnabled && isWechatProvider) {
        await tx.socialProvider.updateMany({
          where: {
            name: {
              in: WECHAT_PROVIDER_NAMES.filter((providerName) => providerName !== name),
            },
          },
          data: { enabled: false },
        });
      }

      return updated;
    });
    return this.toApi(provider);
  }

  async delete(name: string) {
    const provider = await this.prismaService.socialProvider.findUnique({
      where: { name },
    });
    if (!provider) {
      throw new NotFoundException(`Social provider "${name}" not found`);
    }
    const presets = ['github', 'google', 'wechat', 'wechat-aggregated', 'qq', 'wechat-mini'];
    if (presets.includes(name)) {
      throw new BadRequestException('内置登录方式不可删除');
    }
    await this.prismaService.socialProvider.delete({ where: { name } });
    return { success: true };
  }

}
