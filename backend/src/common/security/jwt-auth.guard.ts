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
import { SessionCookieService } from './session-cookie.service';
import type { SessionTokenType } from './token.service';
import { TokenService } from './token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly tokenService: TokenService,
    private readonly sessionCookieService: SessionCookieService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const authorization = request.headers.authorization;
    const bearerToken = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : null;
    const token = bearerToken ?? this.sessionCookieService.getAccessTokenFromRequest(request);

    if (!token) {
      throw new UnauthorizedException('缺少认证令牌');
    }

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

      if (payload.token_use !== 'access') {
        throw new UnauthorizedException('令牌用途无效');
      }

      const sessionType = this.resolveSessionType(
        storedToken.tokenType,
        payload.session_type,
        storedToken.clientId,
      );
      this.assertTokenBoundary(request.path, sessionType, payload.aud, storedToken.clientId);

      request.user = {
        id: payload.sub,
        email: payload.email,
        role: storedToken.user.role === UserRole.ADMIN ? 'admin' : 'user',
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
        clientId: storedToken.clientId ?? null,
        token,
        audience: String(payload.aud),
        sessionType,
      };

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('认证令牌无效');
    }
  }

  private resolveSessionType(
    storedTokenType: string,
    payloadSessionType: unknown,
    clientId: string | null,
  ): SessionTokenType {
    if (storedTokenType === 'web_session' || storedTokenType === 'oauth_access') {
      if (payloadSessionType !== storedTokenType) {
        throw new UnauthorizedException('令牌上下文不匹配');
      }
      return storedTokenType;
    }

    if (storedTokenType === 'Bearer') {
      return clientId ? 'oauth_access' : 'web_session';
    }

    throw new UnauthorizedException('令牌类型无效');
  }

  private assertTokenBoundary(
    path: string,
    sessionType: SessionTokenType,
    audience: unknown,
    clientId: string | null,
  ) {
    if (sessionType === 'web_session') {
      if (audience !== 'sso-web') {
        throw new UnauthorizedException('令牌受众无效');
      }
      return;
    }

    if (path !== '/oauth2/userinfo') {
      throw new UnauthorizedException('OAuth 应用令牌不能访问站内接口');
    }

    if (!clientId || audience !== clientId) {
      throw new UnauthorizedException('OAuth 令牌受众无效');
    }
  }
}
