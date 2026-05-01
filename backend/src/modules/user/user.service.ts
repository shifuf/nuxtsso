import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  username?: string;

  @IsString()
  @MinLength(3)
  password!: string;

  @IsOptional()
  @IsIn(['admin', 'user'])
  role?: 'admin' | 'user';
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  username?: string;

  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  avatar?: string | null;

  @IsOptional()
  @IsBoolean()
  emailVerified?: boolean;

  @IsOptional()
  @IsIn(['admin', 'user'])
  role?: 'admin' | 'user';
}

export class UpdateCurrentUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  username?: string;

  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  avatar?: string | null;
}

export class BindPhoneDto {
  @IsString()
  @Matches(/^\+?[0-9\s-]{6,20}$/, {
    message: 'Phone number is invalid',
  })
  phone!: string;
}

@Injectable()
export class UserService {
  constructor(private readonly prismaService: PrismaService) {}

  private async requireUserEntity(id: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return user;
  }

  private async assertUsernameAvailable(
    username: string,
    excludeUserId?: string,
  ) {
    const existingUser = await this.prismaService.user.findFirst({
      where: {
        username,
        ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
      },
    });

    if (existingUser) {
      throw new ConflictException('用户名已被占用');
    }
  }

  private normalizePhone(phone: string) {
    return phone.trim().replace(/[\s-]/g, '');
  }

  private async assertPhoneAvailable(phone: string, excludeUserId?: string) {
    const existingUser = await this.prismaService.user.findFirst({
      where: {
        phone,
        ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
      },
    });

    if (existingUser) {
      throw new ConflictException('手机号已绑定其他账号');
    }
  }

  toApiUser(user: {
    id: string;
    username: string | null;
    email: string | null;
    phone: string | null;
    emailVerified: boolean;
    status: UserStatus;
    role: UserRole;
    avatar: string | null;
    registrationSource: string | null;
    registerClientId: string | null;
    passwordHash?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      emailVerified: user.emailVerified,
      status: user.status.toLowerCase(),
      role: user.role.toLowerCase(),
      avatar: user.avatar,
      registrationSource: user.registrationSource,
      registerClientId: user.registerClientId,
      hasPassword: !!user.passwordHash,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async findForSession(userId: string) {
    const user = await this.requireUserEntity(userId);
    return this.toApiUser(user);
  }

  async listUsers(query?: string) {
    const users = await this.prismaService.user.findMany({
      where: query
        ? {
            OR: [
              { email: { contains: query } },
              { username: { contains: query } },
              { id: { contains: query } },
            ],
          }
        : undefined,
      include: {
        socialAccounts: {
          select: { provider: true, providerUserId: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const clientIds = [...new Set(users.map(u => u.registerClientId).filter(Boolean))] as string[];
    const appMap = new Map<string, string>();
    if (clientIds.length) {
      const apps = await this.prismaService.application.findMany({
        where: { clientId: { in: clientIds } },
        select: { clientId: true, name: true },
      });
      for (const a of apps) appMap.set(a.clientId, a.name);
    }

    // Batch lookup: social-registered users without bindings → find where their SocialAccount went
    const SOCIAL_SOURCES = ['wechat', 'qq', 'github', 'google'];
    const orphaned = users.filter(u => !u.socialAccounts.length && u.registrationSource && SOCIAL_SOURCES.includes(u.registrationSource));
    const boundMap = new Map<string, { id: string; username: string | null; email: string | null }>();

    if (orphaned.length) {
      // Try precise match via email pattern first
      const lookups: { userId: string; provider: string; providerUserId: string }[] = [];
      for (const u of orphaned) {
        const provider = u.registrationSource!;
        const prefix = `${provider}_`;
        const suffix = '@social.local';
        if (u.email?.startsWith(prefix) && u.email.endsWith(suffix)) {
          const providerUserId = u.email.slice(prefix.length, -suffix.length);
          lookups.push({ userId: u.id, provider, providerUserId });
        }
      }
      if (lookups.length) {
        const accounts = await this.prismaService.socialAccount.findMany({
          where: { OR: lookups.map(l => ({ provider: l.provider, providerUserId: l.providerUserId })) },
          include: { user: { select: { id: true, username: true, email: true } } },
        });
        for (const sa of accounts) {
          const match = lookups.find(l => l.provider === sa.provider && l.providerUserId === sa.providerUserId);
          if (match && sa.userId !== match.userId) {
            boundMap.set(match.userId, { id: sa.user.id, username: sa.user.username, email: sa.user.email });
          }
        }
      }

      // Fallback: match by provider only (covers cases where providerUserId differs from email-embedded value)
      const unmatched = orphaned.filter(u => !boundMap.has(u.id));
      if (unmatched.length) {
        const providers = [...new Set(unmatched.map(u => u.registrationSource!))];
        const accounts = await this.prismaService.socialAccount.findMany({
          where: { provider: { in: providers } },
          include: { user: { select: { id: true, username: true, email: true } } },
        });
        for (const u of unmatched) {
          const match = accounts.find(sa => sa.provider === u.registrationSource && sa.userId !== u.id);
          if (match) {
            boundMap.set(u.id, { id: match.user.id, username: match.user.username, email: match.user.email });
          }
        }
      }
    }

    return users.map((user) => ({
      ...this.toApiUser(user),
      registerClientName: user.registerClientId ? (appMap.get(user.registerClientId) ?? null) : null,
      socialAccounts: user.socialAccounts,
      boundToUser: boundMap.get(user.id) ?? null,
    }));
  }

  async getUserById(id: string) {
    const user = await this.requireUserEntity(id);
    return this.toApiUser(user);
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    await this.requireUserEntity(id);

    if (dto.username !== undefined && dto.username.trim()) {
      await this.assertUsernameAvailable(dto.username.trim(), id);
    }

    const user = await this.prismaService.user.update({
      where: { id },
      data: {
        username:
          dto.username === undefined ? undefined : dto.username.trim() || null,
        avatar:
          dto.avatar === undefined ? undefined : dto.avatar?.trim() || null,
        emailVerified: dto.emailVerified,
        role:
          dto.role === undefined
            ? undefined
            : dto.role === 'admin'
              ? UserRole.ADMIN
              : UserRole.USER,
      },
    });

    return this.toApiUser(user);
  }

  async updateStatus(id: string, status: 'active' | 'disabled') {
    await this.requireUserEntity(id);

    const user = await this.prismaService.user.update({
      where: { id },
      data: {
        status: status === 'active' ? UserStatus.ACTIVE : UserStatus.DISABLED,
      },
    });

    return this.toApiUser(user);
  }

  async createUser(dto: CreateUserDto) {
    const existingUser = await this.prismaService.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new BadRequestException('邮箱已被注册');
    }

    const username = dto.username?.trim() || dto.email.split('@')[0];
    await this.assertUsernameAvailable(username);

    const user = await this.prismaService.user.create({
      data: {
        email: dto.email,
        username,
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: dto.role === 'admin' ? UserRole.ADMIN : UserRole.USER,
        emailVerified: false,
        registrationSource: 'admin',
      },
    });

    return this.toApiUser(user);
  }

  async resetPassword(id: string, newPassword: string) {
    await this.requireUserEntity(id);

    const user = await this.prismaService.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });

    return this.toApiUser(user);
  }

  async deleteUser(id: string) {
    await this.requireUserEntity(id);

    await this.prismaService.user.delete({
      where: { id },
    });

    return { success: true };
  }

  async updateCurrentUser(id: string, dto: UpdateCurrentUserDto) {
    await this.requireUserEntity(id);

    if (dto.username !== undefined && dto.username.trim()) {
      await this.assertUsernameAvailable(dto.username.trim(), id);
    }

    const user = await this.prismaService.user.update({
      where: { id },
      data: {
        username:
          dto.username === undefined ? undefined : dto.username.trim() || null,
        avatar:
          dto.avatar === undefined ? undefined : dto.avatar?.trim() || null,
      },
    });

    return this.toApiUser(user);
  }

  async bindPhone(id: string, phone: string) {
    await this.requireUserEntity(id);

    const normalizedPhone = this.normalizePhone(phone);
    await this.assertPhoneAvailable(normalizedPhone, id);

    const user = await this.prismaService.user.update({
      where: { id },
      data: {
        phone: normalizedPhone,
      },
    });

    return this.toApiUser(user);
  }

  async unbindPhone(id: string) {
    await this.requireUserEntity(id);

    const user = await this.prismaService.user.update({
      where: { id },
      data: {
        phone: null,
      },
    });

    return this.toApiUser(user);
  }

  async bindSocialAccount(userId: string, provider: string, providerUserId: string, profile?: string) {
    await this.requireUserEntity(userId);

    // Resolve the real openid: if no SocialAccount exists with this providerUserId,
    // try to find the social-registered user and extract openid from their email pattern
    let realProviderUserId = providerUserId;
    const existingByInput = await this.prismaService.socialAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
    });

    if (!existingByInput) {
      const prefix = `${provider}_`;
      const suffix = '@social.local';
      const socialUser = await this.prismaService.user.findFirst({
        where: {
          registrationSource: provider,
          email: { startsWith: prefix, endsWith: suffix },
        },
      });
      if (socialUser?.email) {
        const extracted = socialUser.email.slice(prefix.length, -suffix.length);
        if (extracted) realProviderUserId = extracted;
      }
    }

    // Check if this social account is already bound to another user
    const existing = await this.prismaService.socialAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId: realProviderUserId,
        },
      },
    });

    if (existing && existing.userId !== userId) {
      throw new BadRequestException('该第三方账号已绑定到其他用户，请先解绑');
    }

    if (existing && existing.userId === userId) {
      return { success: true, message: '已绑定' };
    }

    await this.prismaService.socialAccount.create({
      data: {
        userId,
        provider,
        providerUserId: realProviderUserId,
        accessToken: '',
        profile: profile || '{}',
      },
    });

    return { success: true };
  }

  async unbindSocialAccount(userId: string, provider: string) {
    await this.requireUserEntity(userId);

    const account = await this.prismaService.socialAccount.findFirst({
      where: {
        userId,
        provider,
      },
    });

    if (!account) {
      throw new BadRequestException(`未绑定 ${provider}`);
    }

    await this.prismaService.socialAccount.delete({
      where: { id: account.id },
    });

    return { success: true };
  }

  async listAllSocialAccounts() {
    const accounts = await this.prismaService.socialAccount.findMany({
      include: {
        user: {
          select: { id: true, username: true, email: true },
        },
      },
      orderBy: [{ provider: 'asc' }, { providerUserId: 'asc' }],
    });

    return accounts.map((a) => ({
      id: a.id,
      provider: a.provider,
      providerUserId: a.providerUserId,
      userId: a.userId,
      boundUsername: a.user.username,
      boundEmail: a.user.email,
    }));
  }

  async assignSocialAccount(userId: string, socialAccountId: string) {
    await this.requireUserEntity(userId);

    const account = await this.prismaService.socialAccount.findUnique({
      where: { id: socialAccountId },
    });

    if (!account) {
      throw new NotFoundException('第三方绑定记录不存在');
    }

    if (account.userId === userId) {
      return { success: true, message: '已绑定到该用户' };
    }

    throw new BadRequestException('该第三方账号已绑定到其他用户，请先解绑');
  }

  async transferSocialBindings(sourceUserId: string, targetUsername: string) {
    await this.requireUserEntity(sourceUserId);

    const targetUser = await this.prismaService.user.findFirst({
      where: { username: targetUsername },
    });
    if (!targetUser) throw new NotFoundException('目标用户不存在');

    if (targetUser.id === sourceUserId) {
      throw new BadRequestException('不能转移到自身');
    }

    const sourceBindings = await this.prismaService.socialAccount.findMany({
      where: { userId: sourceUserId },
    });

    if (!sourceBindings.length) {
      throw new BadRequestException('该用户没有第三方绑定可转移');
    }

    // Check target has no conflict
    for (const b of sourceBindings) {
      const conflict = await this.prismaService.socialAccount.findFirst({
        where: { userId: targetUser.id, provider: b.provider },
      });
      if (conflict) {
        throw new BadRequestException(`目标用户已绑定了 ${b.provider}，请先解绑`);
      }
    }

    await this.prismaService.socialAccount.updateMany({
      where: { userId: sourceUserId },
      data: { userId: targetUser.id },
    });

    return { success: true, transferred: sourceBindings.length };
  }
}
