import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApplicationStatus } from '@prisma/client';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { createHash, randomBytes } from 'node:crypto';
import { TokenService } from '../../common/security/token.service';
import type { RequestUser } from '../../common/security/request-user.interface';
import { PrismaService } from '../../database/prisma.service';
import { parseStringArray, toJsonString } from '../../common/utils/json.util';
import { AuditService } from '../audit/audit.service';
import { ApplicationService } from '../application/application.service';
import { AuthService } from '../auth/auth.service';

export class AuthorizeQueryDto {
  @IsString()
  client_id!: string;

  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  redirect_uri!: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  code_challenge?: string;

  @IsOptional()
  @IsIn(['S256', 'plain'])
  code_challenge_method?: 'S256' | 'plain';

  @IsOptional()
  @IsString()
  nonce?: string;

  @IsOptional()
  @IsIn(['code'])
  response_type?: 'code';
}

export class AuthorizeDecisionDto extends AuthorizeQueryDto {
  @IsIn(['approve', 'deny'])
  decision!: 'approve' | 'deny';
}

export class TokenRequestDto {
  @IsIn(['authorization_code', 'refresh_token'])
  grant_type!: 'authorization_code' | 'refresh_token';

  @IsString()
  client_id!: string;

  @IsOptional()
  @IsString()
  client_secret?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  redirect_uri?: string;

  @IsOptional()
  @IsString()
  code_verifier?: string;

  @IsOptional()
  @IsString()
  refresh_token?: string;
}

@Injectable()
export class Oauth2Service {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly applicationService: ApplicationService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly tokenService: TokenService,
  ) {}

  private computeCodeChallenge(verifier: string, method?: 'S256' | 'plain') {
    if (method === 'plain') {
      return verifier;
    }

    return createHash('sha256').update(verifier).digest('base64url');
  }

  private resolveScopes(requestedScope: string | undefined, availableScopes: string[]) {
    const requestedScopes = requestedScope
      ? requestedScope.split(' ').map((item) => item.trim()).filter(Boolean)
      : availableScopes;
    const invalidScopes = requestedScopes.filter(
      (scope) => !availableScopes.includes(scope),
    );

    if (invalidScopes.length) {
      throw new BadRequestException(
        `不支持的权限范围：${invalidScopes.join(', ')}`,
      );
    }

    return requestedScopes;
  }

  async getAuthorizeMetadata(query: AuthorizeQueryDto) {
    const { application, scopes } =
      await this.applicationService.resolveAuthorizeContext(
        query.client_id,
        query.redirect_uri,
      );
    const requestedScopes = this.resolveScopes(query.scope, scopes);
    const requireEmailVerification = await this.authService.getRequireEmailVerification();

    return {
      clientId: application.clientId,
      clientName: application.name,
      description: application.description,
      redirectUri: query.redirect_uri,
      allowRegistration: application.allowRegistration,
      requestedScopes,
      availableScopes: scopes,
      requireEmailVerification,
    };
  }

  async validateClient(clientId: string, clientSecret: string) {
    const valid = await this.applicationService.validateClientSecret(clientId, clientSecret);
    if (!valid) {
      throw new UnauthorizedException('Client ID 和密钥不匹配');
    }
    return { valid: true };
  }

  async authorize(user: RequestUser, dto: AuthorizeDecisionDto) {
    const { application, scopes } =
      await this.applicationService.resolveAuthorizeContext(
        dto.client_id,
        dto.redirect_uri,
      );
    const requestedScopes = this.resolveScopes(dto.scope, scopes);

    if (dto.decision === 'deny') {
      return {
        redirectTo: `${dto.redirect_uri}${
          dto.redirect_uri.includes('?') ? '&' : '?'
        }error=access_denied${dto.state ? `&state=${encodeURIComponent(dto.state)}` : ''}`,
      };
    }

    const code = randomBytes(24).toString('base64url');

    await this.prismaService.oauthAuthorizationCode.create({
      data: {
        code,
        clientId: application.clientId,
        userId: user.id,
        redirectUri: dto.redirect_uri,
        scopes: toJsonString(requestedScopes),
        state: dto.state,
        nonce: dto.nonce,
        codeChallenge: dto.code_challenge,
        codeChallengeMethod: dto.code_challenge_method,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    await this.auditService.create({
      action: 'oauth2.authorize',
      actorId: user.id,
      actorEmail: user.email,
      applicationId: application.clientId,
      metadata: {
        scopes: requestedScopes,
      },
    });

    const redirectTo = `${dto.redirect_uri}${
      dto.redirect_uri.includes('?') ? '&' : '?'
    }code=${encodeURIComponent(code)}${
      dto.state ? `&state=${encodeURIComponent(dto.state)}` : ''
    }`;

    return {
      code,
      redirectTo,
    };
  }

  async exchangeToken(dto: TokenRequestDto) {
    if (dto.grant_type === 'refresh_token') {
      return this.exchangeRefreshToken(dto);
    }

    if (!dto.code || !dto.redirect_uri) {
      throw new BadRequestException('授权码和回调地址为必填项');
    }

    const authorizationCode =
      await this.prismaService.oauthAuthorizationCode.findUnique({
        where: { code: dto.code },
        include: {
          user: true,
          client: true,
        },
      });

    if (!authorizationCode) {
      throw new BadRequestException('授权码无效');
    }

    if (authorizationCode.usedAt) {
      throw new BadRequestException('授权码已被使用');
    }

    if (authorizationCode.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('授权码已过期');
    }

    if (
      authorizationCode.clientId !== dto.client_id ||
      authorizationCode.redirectUri !== dto.redirect_uri
    ) {
      throw new BadRequestException('授权码与应用不匹配');
    }

    if (authorizationCode.client.status !== ApplicationStatus.ACTIVE) {
      throw new BadRequestException('该应用已被禁用');
    }

    if (authorizationCode.codeChallenge) {
      if (!dto.code_verifier) {
        throw new BadRequestException('PKCE 验证需要提供 code_verifier');
      }

      const actualChallenge = this.computeCodeChallenge(
        dto.code_verifier,
        authorizationCode.codeChallengeMethod === 'plain' ? 'plain' : 'S256',
      );

      if (actualChallenge !== authorizationCode.codeChallenge) {
        throw new BadRequestException('PKCE 验证失败');
      }
    } else {
      const clientSecretMatches = await this.applicationService.validateClientSecret(
        dto.client_id,
        dto.client_secret,
      );

      if (!clientSecretMatches) {
        throw new UnauthorizedException('Client ID 和密钥不匹配');
      }
    }

    await this.prismaService.oauthAuthorizationCode.update({
      where: { id: authorizationCode.id },
      data: {
        usedAt: new Date(),
      },
    });

    const scopes = parseStringArray(authorizationCode.scopes);

    return this.authService.issueTokensForUser({
      user: authorizationCode.user,
      scopes,
      clientId: authorizationCode.clientId,
      includeIdToken: scopes.includes('openid'),
      nonce: authorizationCode.nonce,
    });
  }

  private async exchangeRefreshToken(dto: TokenRequestDto) {
    if (!dto.refresh_token) {
      throw new BadRequestException('刷新令牌为必填项');
    }

    const token = await this.authService.findTokenByRefreshToken(dto.refresh_token);

    if (!token) {
      throw new UnauthorizedException('刷新令牌无效');
    }

    if (token.clientId && token.clientId !== dto.client_id) {
      throw new UnauthorizedException('刷新令牌与应用不匹配');
    }

    if (token.clientId) {
      const app = await this.applicationService.getApplicationByClientId(token.clientId);
      const hasSecret = app.clientSecretHash && app.clientSecretHash.length > 0;
      if (hasSecret) {
        if (!dto.client_secret) {
          throw new UnauthorizedException('Client ID 和密钥不匹配');
        }
        const valid = await this.applicationService.validateClientSecret(
          dto.client_id,
          dto.client_secret,
        );
        if (!valid) {
          throw new UnauthorizedException('Client ID 和密钥不匹配');
        }
      }
    }

    await this.authService.revokeRefreshToken(dto.refresh_token);

    return this.authService.issueTokensForUser({
      user: token.user,
      scopes: parseStringArray(token.scopes),
      clientId: token.clientId,
      includeIdToken: false,
    });
  }

  getDiscoveryDocument() {
    const issuer = this.tokenService.getIssuer();

    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      token_endpoint: `${issuer}/oauth2/token`,
      userinfo_endpoint: `${issuer}/oauth2/userinfo`,
      jwks_uri: `${issuer}/oauth2/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email'],
      token_endpoint_auth_methods_supported: [
        'client_secret_post',
        'none',
      ],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256', 'plain'],
    };
  }

  getJwks() {
    return this.tokenService.getJwks();
  }

  getUserInfo(user: RequestUser) {
    return {
      sub: user.id,
      name: user.email.split('@')[0],
      email: user.email,
      email_verified: true,
      picture: null,
    };
  }
}
