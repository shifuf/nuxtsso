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
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
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
  @IsUrl({ require_tld: false, require_protocol: true })
  redirectUri?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  authUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  tokenUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  userInfoUrl?: string;
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

@Injectable()
export class SocialProviderService implements OnModuleInit {
  private readonly logger = new Logger(SocialProviderService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async onModuleInit() {
    await this.ensureDefaults();
  }

  private async ensureDefaults() {
    const defaults = ['github', 'google', 'wechat', 'qq'];
    for (const name of defaults) {
      await this.prismaService.socialProvider.upsert({
        where: { name },
        update: {},
        create: { name },
      });
    }
    this.logger.log(`Ensured ${defaults.length} default social providers`);
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
  }) {
    return {
      name: provider.name,
      type: provider.type as 'oauth' | 'aggregated',
      enabled: provider.enabled,
      clientId: provider.clientId,
      clientSecret: provider.clientSecret,
      apiUrl: provider.apiUrl ?? '',
      redirectUri: provider.redirectUri ?? '',
      scopes: provider.scopes ? parseStringArray(provider.scopes) : [],
      authUrl: provider.authUrl ?? '',
      tokenUrl: provider.tokenUrl ?? '',
      userInfoUrl: provider.userInfoUrl ?? '',
    };
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

  async update(name: string, dto: UpdateSocialProviderDto) {
    const existing = await this.prismaService.socialProvider.findUnique({
      where: { name },
    });
    if (!existing) {
      throw new NotFoundException(`Social provider "${name}" not found`);
    }

    const wantEnabled = dto.enabled ?? existing.enabled;
    const clientId = dto.clientId ?? existing.clientId;
    const clientSecret = dto.clientSecret ?? existing.clientSecret;
    if (wantEnabled && (!clientId.trim() || !clientSecret.trim())) {
      throw new BadRequestException('启用前请先填写 Client ID 和 Client Secret');
    }

    const provider = await this.prismaService.socialProvider.update({
      where: { name },
      data: {
        type: dto.type,
        enabled: dto.enabled,
        clientId: dto.clientId,
        clientSecret: dto.clientSecret,
        apiUrl: dto.apiUrl,
        redirectUri: dto.redirectUri,
        scopes:
          dto.scopes === undefined ? undefined : toJsonString(dto.scopes),
        authUrl: dto.authUrl,
        tokenUrl: dto.tokenUrl,
        userInfoUrl: dto.userInfoUrl,
      },
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
    const presets = ['github', 'google', 'wechat', 'qq'];
    if (presets.includes(name)) {
      throw new BadRequestException('内置登录方式不可删除');
    }
    await this.prismaService.socialProvider.delete({ where: { name } });
    return { success: true };
  }

}
