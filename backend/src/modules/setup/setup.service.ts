import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { TokenService } from '../../common/security/token.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { UserService } from '../user/user.service';

export class SetupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(50)
  username!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serviceName?: string;

  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  issuer?: string;
}

@Injectable()
export class SetupService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly tokenService: TokenService,
  ) {}

  private assertPasswordPolicy(password: string) {
    if (password.length < 8) {
      throw new BadRequestException('密码长度不能少于 8 位');
    }

    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      throw new BadRequestException('密码必须同时包含字母和数字');
    }
  }

  async getStatus() {
    const adminCount = await this.prismaService.user.count({
      where: { role: UserRole.ADMIN },
    });

    return {
      initialized: adminCount > 0,
      hasAdmin: adminCount > 0,
    };
  }

  async runSetup(dto: SetupDto) {
    const status = await this.getStatus();

    if (status.initialized) {
      throw new BadRequestException('系统已经初始化过了');
    }

    this.assertPasswordPolicy(dto.password);

    if (dto.serviceName?.trim()) {
      await this.prismaService.systemSetting.upsert({
        where: { key: 'site-config' },
        create: {
          key: 'site-config',
          value: JSON.stringify({
            siteName: dto.serviceName.trim(),
            footerCopyright: `© 2026 ${dto.serviceName.trim()}. All rights reserved.`,
            icpNumber: '',
          }),
        },
        update: {
          value: JSON.stringify({
            siteName: dto.serviceName.trim(),
            footerCopyright: `© 2026 ${dto.serviceName.trim()}. All rights reserved.`,
            icpNumber: '',
          }),
        },
      });
    }

    if (dto.issuer?.trim()) {
      const issuer = dto.issuer.trim().replace(/\/+$/, '');
      await this.prismaService.systemSetting.upsert({
        where: { key: 'oidc-issuer' },
        create: { key: 'oidc-issuer', value: issuer },
        update: { value: issuer },
      });
      this.tokenService.setRuntimeIssuer(issuer);
    }

    const user = await this.prismaService.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        passwordHash: await bcrypt.hash(dto.password, 10),
        emailVerified: true,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        registrationSource: 'setup',
      },
    });

    const tokens = await this.authService.issueTokensForUser({
      user,
      scopes: ['profile', 'email'],
    });

    return {
      ...tokens,
      user: this.userService.toApiUser(user),
    };
  }
}
