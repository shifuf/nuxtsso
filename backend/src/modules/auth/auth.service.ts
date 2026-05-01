import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus, VerificationCodeType } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomInt } from 'node:crypto';
import { TokenService } from '../../common/security/token.service';
import { PrismaService } from '../../database/prisma.service';
import { parseStringArray, toJsonString } from '../../common/utils/json.util';
import { AuditService } from '../audit/audit.service';
import { ApplicationService } from '../application/application.service';
import { EmailConfigService } from '../email-config/email-config.service';
import { UserService } from '../user/user.service';

export class SendEmailCodeDto {
  @IsEmail()
  email!: string;

  @IsIn(['login', 'register', 'reset-password'])
  type!: 'login' | 'register' | 'reset-password';

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  redirectUri?: string;
}

export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(3)
  password!: string;

  @IsOptional()
  @IsBoolean()
  mainSite?: boolean;
}

export class LoginEmailDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  redirectUri?: string;
}

export class RegisterDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code?: string;

  @IsString()
  @MinLength(3)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  username?: string;

  @IsString()
  clientId!: string;

  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  redirectUri!: string;
}

export class PublicRegisterDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code?: string;

  @IsString()
  @MinLength(3)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  username?: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;

  @IsString()
  @MinLength(3)
  newPassword!: string;
}

interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

interface IssueTokensOptions {
  user: {
    id: string;
    email: string | null;
    role: UserRole;
    username: string | null;
    emailVerified: boolean;
    status: UserStatus;
    avatar: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  scopes: string[];
  clientId?: string | null;
  includeIdToken?: boolean;
  nonce?: string | null;
}

export interface AccountSessionInfo {
  id: string;
  clientId: string | null;
  clientName: string | null;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  refreshExpiresAt: string | null;
  current: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly userService: UserService,
    private readonly applicationService: ApplicationService,
    private readonly auditService: AuditService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService,
    private readonly emailConfigService: EmailConfigService,
  ) {}

  private mapCodeType(type: SendEmailCodeDto['type']) {
    switch (type) {
      case 'login':
        return VerificationCodeType.LOGIN;
      case 'register':
        return VerificationCodeType.REGISTER;
      default:
        return VerificationCodeType.RESET_PASSWORD;
    }
  }

  async getAuthConfig(): Promise<{ requireEmailVerification: boolean; publicApiEnabled: boolean }> {
    const raw = await this.prismaService.systemSetting.findUnique({
      where: { key: 'auth-config' },
    });

    if (!raw) {
      return { requireEmailVerification: true, publicApiEnabled: false };
    }

    try {
      const parsed = JSON.parse(raw.value);
      return {
        requireEmailVerification: parsed.requireEmailVerification ?? true,
        publicApiEnabled: parsed.publicApiEnabled ?? false,
      };
    } catch {
      return { requireEmailVerification: true, publicApiEnabled: false };
    }
  }

  async updateAuthConfig(config: { requireEmailVerification: boolean; publicApiEnabled?: boolean }) {
    const current = await this.getAuthConfig();
    const merged = {
      requireEmailVerification: config.requireEmailVerification,
      publicApiEnabled: config.publicApiEnabled ?? current.publicApiEnabled,
    };
    await this.prismaService.systemSetting.upsert({
      where: { key: 'auth-config' },
      create: { key: 'auth-config', value: JSON.stringify(merged) },
      update: { value: JSON.stringify(merged) },
    });
    return merged;
  }

  async getRequireEmailVerification(): Promise<boolean> {
    const config = await this.getAuthConfig();
    return config.requireEmailVerification;
  }

  private buildCode() {
    return `${randomInt(100000, 999999)}`;
  }

  private buildRefreshToken() {
    return randomBytes(32).toString('base64url');
  }

  private buildDefaultScopes() {
    return ['profile', 'email'];
  }

  private isDebugEmailCodeEnabled() {
    return this.configService.get<boolean>('ENABLE_DEBUG_EMAIL_CODE') ?? true;
  }

  private normalizeRole(role: UserRole) {
    return role === UserRole.ADMIN ? 'admin' : 'user';
  }

  private toApiAccountSession(
    session: {
      id: string;
      accessToken: string;
      clientId: string | null;
      scopes: string;
      createdAt: Date;
      expiresAt: Date;
      refreshExpiresAt: Date | null;
      client?: {
        name: string;
      } | null;
    },
    currentAccessToken?: string | null,
  ): AccountSessionInfo {
    return {
      id: session.id,
      clientId: session.clientId ?? null,
      clientName: session.client?.name ?? null,
      scopes: parseStringArray(session.scopes),
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      refreshExpiresAt: session.refreshExpiresAt?.toISOString() ?? null,
      current: session.accessToken === (currentAccessToken ?? null),
    };
  }

  async issueTokensForUser(options: IssueTokensOptions) {
    const scopes = options.scopes.length ? options.scopes : this.buildDefaultScopes();
    const audience = options.clientId ?? 'sso-web';
    const email = options.user.email ?? '';
    const accessToken = await this.tokenService.issueToken({
      userId: options.user.id,
      email,
      role: this.normalizeRole(options.user.role),
      scopes,
      audience,
      type: 'access',
    });
    const refreshToken = this.buildRefreshToken();
    const idToken = options.includeIdToken
      ? await this.tokenService.issueToken({
          userId: options.user.id,
          email,
          role: this.normalizeRole(options.user.role),
          scopes,
          audience,
          nonce: options.nonce ?? undefined,
          type: 'id',
        })
      : undefined;
    const accessTokenExpiresIn =
      this.tokenService.getAccessTokenExpiresInSeconds();
    const refreshTokenExpiresIn =
      this.tokenService.getRefreshTokenExpiresInSeconds();

    await this.prismaService.oauthToken.create({
      data: {
        accessToken,
        refreshToken,
        clientId: options.clientId ?? null,
        userId: options.user.id,
        scopes: toJsonString(scopes),
        expiresAt: new Date(Date.now() + accessTokenExpiresIn * 1000),
        refreshExpiresAt: new Date(Date.now() + refreshTokenExpiresIn * 1000),
      },
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: accessTokenExpiresIn,
      scope: scopes.join(' '),
      ...(idToken ? { id_token: idToken } : {}),
    };
  }

  private async consumeVerificationCode(
    email: string,
    type: VerificationCodeType,
    code: string,
  ) {
    const verificationCode = await this.prismaService.verificationCode.findFirst({
      where: {
        email,
        type,
        code,
        usedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!verificationCode) {
      throw new BadRequestException('验证码无效或已过期');
    }

    await this.prismaService.verificationCode.update({
      where: { id: verificationCode.id },
      data: {
        usedAt: new Date(),
      },
    });

    return verificationCode;
  }

  async sendEmailCode(dto: SendEmailCodeDto, meta: RequestMeta) {
    const codeType = this.mapCodeType(dto.type);

    if (dto.type === 'login') {
      const config = await this.getAuthConfig();
      if (!config.requireEmailVerification) {
        throw new BadRequestException('邮箱验证码登录未启用');
      }
    }

    if (dto.type === 'register') {
      await this.applicationService.assertRegistrationAllowed(
        dto.clientId,
        dto.redirectUri,
      );
    } else {
      const user = await this.prismaService.user.findUnique({
        where: { email: dto.email },
      });

      if (!user) {
        throw new NotFoundException('用户不存在');
      }
    }

    const code = this.buildCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const emailConfigured = await this.emailConfigService.isConfigured();

    const verificationCode = await this.prismaService.verificationCode.create({
      data: {
        email: dto.email,
        type: codeType,
        code,
        context:
          dto.clientId || dto.redirectUri
            ? toJsonString({
                clientId: dto.clientId ?? null,
                redirectUri: dto.redirectUri ?? null,
              })
            : null,
        expiresAt,
      },
    });

    try {
      if (emailConfigured) {
        await this.emailConfigService.sendVerificationCode(
          dto.email,
          dto.type,
          code,
          expiresAt,
        );
      } else if (!this.isDebugEmailCodeEnabled()) {
        throw new BadRequestException('邮件服务未配置');
      }
    } catch (error) {
      await this.prismaService.verificationCode.delete({
        where: { id: verificationCode.id },
      });
      throw error;
    }

    await this.auditService.create({
      action: `auth.email_code.${dto.type}`,
      actorEmail: dto.email,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        clientId: dto.clientId ?? null,
        redirectUri: dto.redirectUri ?? null,
      },
    });

    return {
      success: true,
      expiresAt,
      ...(this.isDebugEmailCodeEnabled() ? { debugCode: code } : {}),
    };
  }

  async login(dto: LoginDto, meta: RequestMeta) {
    const user = await this.prismaService.user.findFirst({
      where: {
        OR: [{ email: dto.username }, { username: dto.username }],
      },
    });

    if (!user?.passwordHash) {
      if (dto.mainSite) {
        throw new UnauthorizedException('该账号不存在，请联系管理员注册');
      }
      throw new UnauthorizedException('用户名或密码错误');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('用户已被禁用');
    }

    const tokens = await this.issueTokensForUser({
      user,
      scopes: this.buildDefaultScopes(),
    });

    await this.auditService.create({
      action: 'auth.login.password',
      actorId: user.id,
      actorEmail: user.email,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      ...tokens,
      user: this.userService.toApiUser(user),
    };
  }

  async loginByEmailCode(dto: LoginEmailDto, meta: RequestMeta) {
    const config = await this.getAuthConfig();
    if (!config.requireEmailVerification) {
      throw new BadRequestException('邮箱验证码登录未启用');
    }
    await this.consumeVerificationCode(
      dto.email,
      VerificationCodeType.LOGIN,
      dto.code,
    );

    const user = await this.prismaService.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('用户已被禁用');
    }

    const tokens = await this.issueTokensForUser({
      user,
      scopes: this.buildDefaultScopes(),
      clientId: dto.clientId ?? null,
    });

    await this.auditService.create({
      action: 'auth.login.email_code',
      actorId: user.id,
      actorEmail: user.email,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      ...tokens,
      user: this.userService.toApiUser(user),
    };
  }

  async register(dto: RegisterDto, meta: RequestMeta) {
    await this.applicationService.assertRegistrationAllowed(
      dto.clientId,
      dto.redirectUri,
    );

    const authConfig = await this.getAuthConfig();

    if (authConfig.requireEmailVerification) {
      if (!dto.email || !dto.code) {
        throw new BadRequestException('邮箱和验证码为必填项');
      }
      await this.consumeVerificationCode(
        dto.email,
        VerificationCodeType.REGISTER,
        dto.code,
      );
    }

    if (!dto.email && !dto.username) {
      throw new BadRequestException('邮箱或用户名至少需要填写一项');
    }

    if (dto.email) {
      const existingUser = await this.prismaService.user.findUnique({
        where: { email: dto.email },
      });

      if (existingUser) {
        throw new BadRequestException('邮箱已被注册');
      }
    }

    const user = await this.prismaService.user.create({
      data: {
        email: dto.email ?? null,
        username: dto.username ?? (dto.email ? dto.email.split('@')[0] : undefined),
        passwordHash: await bcrypt.hash(dto.password, 10),
        emailVerified: !!dto.email,
        registrationSource: 'register',
        registerClientId: dto.clientId,
      },
    });

    const tokens = await this.issueTokensForUser({
      user,
      scopes: this.buildDefaultScopes(),
      clientId: dto.clientId,
    });

    await this.auditService.create({
      action: 'auth.register',
      actorId: user.id,
      actorEmail: user.email,
      applicationId: dto.clientId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      ...tokens,
      user: this.userService.toApiUser(user),
    };
  }

  async publicRegister(dto: PublicRegisterDto, meta: RequestMeta) {
    const config = await this.getAuthConfig();
    if (!config.publicApiEnabled) {
      throw new BadRequestException('开放注册 API 未启用，请联系管理员开启');
    }

    if (config.requireEmailVerification) {
      if (!dto.email || !dto.code) {
        throw new BadRequestException('邮箱和验证码为必填项');
      }
      await this.consumeVerificationCode(
        dto.email,
        VerificationCodeType.REGISTER,
        dto.code,
      );
    }

    if (!dto.email && !dto.username) {
      throw new BadRequestException('邮箱或用户名至少需要填写一项');
    }

    if (dto.email) {
      const existingUser = await this.prismaService.user.findUnique({
        where: { email: dto.email },
      });
      if (existingUser) {
        throw new BadRequestException('邮箱已被注册');
      }
    }

    if (dto.username) {
      const existingUser = await this.prismaService.user.findUnique({
        where: { username: dto.username },
      });
      if (existingUser) {
        throw new BadRequestException('用户名已被占用');
      }
    }

    const user = await this.prismaService.user.create({
      data: {
        email: dto.email ?? null,
        username: dto.username ?? (dto.email ? dto.email.split('@')[0] : undefined),
        passwordHash: await bcrypt.hash(dto.password, 10),
        emailVerified: !!dto.email,
        registrationSource: 'public-api',
      },
    });

    const tokens = await this.issueTokensForUser({
      user,
      scopes: this.buildDefaultScopes(),
    });

    await this.auditService.create({
      action: 'auth.register',
      actorId: user.id,
      actorEmail: user.email,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { source: 'public-api' },
    });

    return {
      ...tokens,
      user: this.userService.toApiUser(user),
    };
  }

  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta) {
    await this.consumeVerificationCode(
      dto.email,
      VerificationCodeType.RESET_PASSWORD,
      dto.code,
    );

    const user = await this.prismaService.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    await this.prismaService.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, 10),
      },
    });

    const revokedSessions = await this.revokeAllUserSessions(user.id);

    await this.auditService.create({
      action: 'auth.reset_password',
      actorId: user.id,
      actorEmail: user.email,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        revokedSessions,
      },
    });

    return {
      success: true,
      revokedSessions,
    };
  }

  async getSession(userId: string) {
    return this.userService.findForSession(userId);
  }

  async listUserSessions(userId: string, currentAccessToken?: string | null) {
    const now = new Date();
    const sessions = await this.prismaService.oauthToken.findMany({
      where: {
        userId,
        revoked: false,
        OR: [
          { expiresAt: { gt: now } },
          { refreshExpiresAt: { gt: now } },
          { refreshExpiresAt: null },
        ],
      },
      include: {
        client: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return sessions.map((session) =>
      this.toApiAccountSession(session, currentAccessToken),
    );
  }

  async revokeRefreshToken(refreshToken: string) {
    await this.prismaService.oauthToken.updateMany({
      where: { refreshToken },
      data: {
        revoked: true,
      },
    });
  }

  async findTokenByRefreshToken(refreshToken: string) {
    return this.prismaService.oauthToken.findFirst({
      where: {
        refreshToken,
        revoked: false,
        refreshExpiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
      },
    });
  }

  async revokeUserSession(
    userId: string,
    sessionId: string,
    currentAccessToken?: string | null,
  ) {
    const session = await this.prismaService.oauthToken.findFirst({
      where: {
        id: sessionId,
        userId,
        revoked: false,
      },
    });

    if (!session) {
      throw new NotFoundException('会话不存在');
    }

    await this.prismaService.oauthToken.update({
      where: { id: session.id },
      data: {
        revoked: true,
      },
    });

    return {
      success: true,
      current: session.accessToken === (currentAccessToken ?? null),
    };
  }

  async revokeOtherUserSessions(userId: string, currentAccessToken: string) {
    const result = await this.prismaService.oauthToken.updateMany({
      where: {
        userId,
        revoked: false,
        NOT: {
          accessToken: currentAccessToken,
        },
      },
      data: {
        revoked: true,
      },
    });

    return {
      success: true,
      revokedCount: result.count,
    };
  }

  async revokeAllUserSessions(userId: string, excludeAccessToken?: string | null) {
    const result = await this.prismaService.oauthToken.updateMany({
      where: {
        userId,
        revoked: false,
        ...(excludeAccessToken
          ? {
              NOT: {
                accessToken: excludeAccessToken,
              },
            }
          : {}),
      },
      data: {
        revoked: true,
      },
    });

    return result.count;
  }

  async getSocialProviders(clientId?: string) {
    const providers = await this.prismaService.socialProvider.findMany({
      select: { name: true, enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    const allProviders = providers.length > 0
      ? providers
      : [
          { name: 'wechat', enabled: false },
          { name: 'qq', enabled: false },
          { name: 'github', enabled: false },
          { name: 'google', enabled: false },
        ];

    if (!clientId) return allProviders;

    const app = await this.prismaService.application.findUnique({
      where: { clientId },
      select: { enabledSocialProviders: true },
    });

    if (!app?.enabledSocialProviders) return [];

    const allowed = JSON.parse(app.enabledSocialProviders) as string[];
    return allProviders.filter(p => allowed.includes(p.name));
  }

  async setPasswordForSocialUser(userId: string, password: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (user.passwordHash) {
      throw new BadRequestException('该账号已设置密码，请使用修改密码功能');
    }

    if (password.length < 6) {
      throw new BadRequestException('密码长度不能少于 6 位');
    }

    const updatedUser = await this.prismaService.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });

    return this.userService.toApiUser(updatedUser);
  }
}
