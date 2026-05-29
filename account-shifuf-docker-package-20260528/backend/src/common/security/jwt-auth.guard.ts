import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../database/prisma.service';
import type { RequestUser } from './request-user.interface';
import { TokenService } from './token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少认证令牌');
    }

    const token = authorization.slice(7);

    try {
      const payload = await this.tokenService.verifyToken(token);
      const storedToken = await this.prismaService.oauthToken.findUnique({
        where: { accessToken: token },
        include: {
          user: true,
        },
      });

      if (!storedToken || storedToken.revoked) {
        throw new UnauthorizedException('令牌无效或已被撤销');
      }

      if (storedToken.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException('令牌已过期');
      }

      if (storedToken.user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('用户已被禁用');
      }

      request.user = {
        id: payload.sub,
        email: payload.email,
        role: storedToken.user.role === UserRole.ADMIN ? 'admin' : 'user',
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
        clientId: storedToken.clientId ?? null,
        token,
      };

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('认证令牌无效');
    }
  }
}
