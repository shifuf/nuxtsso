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
  @MinLength(3)
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
  ) {}

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
