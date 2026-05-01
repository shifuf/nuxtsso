import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service';
import {
  parseStringArray,
  toJsonString,
  uniqueStringArray,
} from '../../common/utils/json.util';

export class CreateApplicationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUrl(
    {
      require_tld: false,
      require_protocol: true,
    },
    { each: true },
  )
  redirectUris!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  scopes!: string[];

  @IsOptional()
  @IsBoolean()
  allowRegistration?: boolean;
}

export class UpdateApplicationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUrl(
    {
      require_tld: false,
      require_protocol: true,
    },
    { each: true },
  )
  redirectUris?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsBoolean()
  allowRegistration?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledSocialProviders?: string[];
}

@Injectable()
export class ApplicationService {
  constructor(
    private readonly prismaService: PrismaService,
  ) {}

  private toApiApplication(application: {
    id: string;
    name: string;
    description: string | null;
    clientId: string;
    redirectUris: string;
    scopes: string;
    allowRegistration: boolean;
    enabledSocialProviders: string | null;
    status: ApplicationStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: application.id,
      name: application.name,
      description: application.description,
      clientId: application.clientId,
      redirectUris: parseStringArray(application.redirectUris),
      scopes: parseStringArray(application.scopes),
      allowRegistration: application.allowRegistration,
      enabledSocialProviders: application.enabledSocialProviders
        ? parseStringArray(application.enabledSocialProviders)
        : [],
      status: application.status.toLowerCase(),
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
    };
  }

  private buildClientId() {
    return `app_${randomBytes(10).toString('hex')}`;
  }

  private buildClientSecret() {
    return `secret_${randomBytes(18).toString('hex')}`;
  }

  async listApplications() {
    const applications = await this.prismaService.application.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    return applications.map((application) => this.toApiApplication(application));
  }

  async getApplicationById(id: string) {
    const application = await this.prismaService.application.findUnique({
      where: { id },
    });

    if (!application) {
      throw new NotFoundException('应用不存在');
    }

    return this.toApiApplication(application);
  }

  async getApplicationByClientId(clientId: string) {
    const application = await this.prismaService.application.findUnique({
      where: { clientId },
    });

    if (!application) {
      throw new NotFoundException('应用不存在');
    }

    return application;
  }

  async createApplication(dto: CreateApplicationDto) {
    const clientSecret = this.buildClientSecret();
    const application = await this.prismaService.application.create({
      data: {
        name: dto.name,
        description: dto.description,
        clientId: this.buildClientId(),
        clientSecretHash: await bcrypt.hash(clientSecret, 10),
        redirectUris: toJsonString(uniqueStringArray(dto.redirectUris)),
        scopes: toJsonString(uniqueStringArray(dto.scopes)),
        allowRegistration: dto.allowRegistration ?? true,
      },
    });

    return {
      ...this.toApiApplication(application),
      clientSecret,
    };
  }

  async updateApplication(id: string, dto: UpdateApplicationDto) {
    await this.getApplicationById(id);

    const application = await this.prismaService.application.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        redirectUris:
          dto.redirectUris === undefined
            ? undefined
            : toJsonString(uniqueStringArray(dto.redirectUris)),
        scopes:
          dto.scopes === undefined
            ? undefined
            : toJsonString(uniqueStringArray(dto.scopes)),
        allowRegistration: dto.allowRegistration,
        enabledSocialProviders:
          dto.enabledSocialProviders === undefined
            ? undefined
            : toJsonString(dto.enabledSocialProviders),
      },
    });

    return this.toApiApplication(application);
  }

  async updateStatus(id: string, status: 'active' | 'disabled') {
    await this.getApplicationById(id);

    const application = await this.prismaService.application.update({
      where: { id },
      data: {
        status:
          status === 'active'
            ? ApplicationStatus.ACTIVE
            : ApplicationStatus.DISABLED,
      },
    });

    return this.toApiApplication(application);
  }

  async deleteApplication(id: string) {
    await this.getApplicationById(id);
    await this.prismaService.application.delete({
      where: { id },
    });

    return {
      success: true,
    };
  }

  async resetSecret(id: string) {
    const application = await this.prismaService.application.findUnique({
      where: { id },
    });

    if (!application) {
      throw new NotFoundException('应用不存在');
    }

    const clientSecret = this.buildClientSecret();
    await this.prismaService.application.update({
      where: { id },
      data: {
        clientSecretHash: await bcrypt.hash(clientSecret, 10),
      },
    });

    await this.prismaService.oauthToken.updateMany({
      where: { clientId: application.clientId, revoked: false },
      data: { revoked: true },
    });

    await this.prismaService.oauthAuthorizationCode.deleteMany({
      where: { clientId: application.clientId, usedAt: null },
    });

    return {
      clientId: application.clientId,
      clientSecret,
    };
  }

  async validateClientSecret(clientId: string, clientSecret?: string) {
    const application = await this.getApplicationByClientId(clientId);

    if (!clientSecret) {
      return false;
    }

    return bcrypt.compare(clientSecret, application.clientSecretHash);
  }

  async resolveAuthorizeContext(clientId: string, redirectUri: string) {
    const application = await this.getApplicationByClientId(clientId);

    if (application.status !== ApplicationStatus.ACTIVE) {
      throw new BadRequestException('该应用已被禁用');
    }

    const redirectUris = parseStringArray(application.redirectUris);

    if (!redirectUris.includes(redirectUri)) {
      throw new BadRequestException('回调地址不在允许范围内');
    }

    return {
      application,
      redirectUris,
      scopes: parseStringArray(application.scopes),
    };
  }

  async assertRegistrationAllowed(clientId?: string, redirectUri?: string) {
    if (!clientId || !redirectUri) {
      throw new BadRequestException('注册需要有效的应用上下文');
    }

    const { application, scopes } = await this.resolveAuthorizeContext(
      clientId,
      redirectUri,
    );

    if (!application.allowRegistration) {
      throw new BadRequestException('该应用未开放注册');
    }

    return {
      application,
      scopes,
    };
  }
}
