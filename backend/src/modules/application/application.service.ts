import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus, Prisma } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { SecretService } from '../../common/security/secret.service';
import { PrismaService } from '../../database/prisma.service';
import {
  parseStringArray,
  toJsonString,
  uniqueStringArray,
} from '../../common/utils/json.util';

const DEFAULT_APPLICATION_SCOPES = ['openid', 'profile', 'email'];

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

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  scopes?: string[];

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

export class ListApplicationsDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

@Injectable()
export class ApplicationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly secretService: SecretService,
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
    ownerId?: string | null;
    owner?: {
      id: string;
      username: string | null;
      email: string | null;
    } | null;
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
      ownerId: application.ownerId ?? null,
      owner: application.owner ?? null,
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

  private resolveScopes(scopes?: string[]) {
    return uniqueStringArray(
      (scopes?.length ? scopes : DEFAULT_APPLICATION_SCOPES)
        .map((scope) => scope.trim())
        .filter(Boolean),
    );
  }

  private normalizePagination(page = 1, pageSize = 20) {
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.min(100, Math.max(1, pageSize));

    return {
      page: normalizedPage,
      pageSize: normalizedPageSize,
      skip: (normalizedPage - 1) * normalizedPageSize,
    };
  }

  private buildListApplicationsWhere(dto: ListApplicationsDto) {
    const conditions: Prisma.ApplicationWhereInput[] = [];
    const query = dto.q?.trim();

    if (query) {
      conditions.push({
        OR: [
          { name: { contains: query } },
          { description: { contains: query } },
          { clientId: { contains: query } },
        ],
      });
    }

    if (dto.status) {
      conditions.push({
        status:
          dto.status === 'active'
            ? ApplicationStatus.ACTIVE
            : ApplicationStatus.DISABLED,
      });
    }

    return conditions.length ? { AND: conditions } : undefined;
  }

  async listApplications(dto: ListApplicationsDto = {}) {
    const { page, pageSize, skip } = this.normalizePagination(
      dto.page,
      dto.pageSize,
    );
    const where = this.buildListApplicationsWhere(dto);

    const [applications, total] = await this.prismaService.$transaction([
      this.prismaService.application.findMany({
        where,
        include: {
          owner: {
            select: { id: true, username: true, email: true },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: pageSize,
      }),
      this.prismaService.application.count({ where }),
    ]);

    return {
      items: applications.map((application) => this.toApiApplication(application)),
      total,
      page,
      pageSize,
    };
  }

  async listUserApplications(userId: string) {
    const applications = await this.prismaService.application.findMany({
      where: { ownerId: userId },
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
    return this.createApplicationForOwner(dto);
  }

  async createApplicationForOwner(dto: CreateApplicationDto, ownerId?: string | null) {
    const clientSecret = this.buildClientSecret();
    const application = await this.prismaService.application.create({
      data: {
        name: dto.name,
        description: dto.description,
        clientId: this.buildClientId(),
        clientSecretHash: await bcrypt.hash(clientSecret, 10),
        encryptedClientSecret: this.secretService.encrypt(clientSecret),
        redirectUris: toJsonString(uniqueStringArray(dto.redirectUris)),
        scopes: toJsonString(this.resolveScopes(dto.scopes)),
        allowRegistration: dto.allowRegistration ?? true,
        ownerId: ownerId ?? null,
        status: ownerId ? ApplicationStatus.DISABLED : ApplicationStatus.ACTIVE,
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
        encryptedClientSecret: this.secretService.encrypt(clientSecret),
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

  async getApplicationSecret(id: string) {
    const application = await this.prismaService.application.findUnique({
      where: { id },
    });

    if (!application) {
      throw new NotFoundException('应用不存在');
    }

    if (!application.encryptedClientSecret) {
      return { clientSecret: null, clientId: application.clientId };
    }

    return {
      clientId: application.clientId,
      clientSecret: this.secretService.decryptMaybe(application.encryptedClientSecret),
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
