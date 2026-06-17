import { UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';

jest.mock('../../common/security/token.service', () => ({
  TokenService: class TokenService {},
}));

import { AuthService } from './auth.service';

describe('AuthService', () => {
  const apiUser = {
    id: 'user-1',
    email: 'user@example.com',
    username: 'user',
    role: 'user',
    status: 'active',
  };
  const user = {
    id: 'user-1',
    email: 'user@example.com',
    username: 'user',
    displayName: null,
    phone: null,
    emailVerified: true,
    status: UserStatus.ACTIVE,
    role: UserRole.USER,
    avatar: null,
    registrationSource: 'register',
    registerClientId: null,
    passwordHash: 'hash',
    lastLoginAt: null,
    createdAt: new Date('2026-06-08T00:00:00.000Z'),
    updatedAt: new Date('2026-06-08T00:00:00.000Z'),
  };
  const userService = {
    toApiUser: jest.fn(() => apiUser),
  };
  const auditService = {
    create: jest.fn(),
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      {} as never,
      userService as never,
      {} as never,
      auditService as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('refreshes a web session by rotating the refresh token', async () => {
    jest.spyOn(service, 'findTokenByRefreshToken').mockResolvedValue({
      tokenType: 'web_session',
      clientId: null,
      scopes: '["profile","email"]',
      user,
    } as never);
    const revokeSpy = jest
      .spyOn(service, 'revokeRefreshToken')
      .mockResolvedValue(undefined);
    const issueSpy = jest.spyOn(service, 'issueTokensForUser').mockResolvedValue({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'profile email',
    });

    const result = await service.refreshWebSession('old-refresh', {
      ip: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(revokeSpy).toHaveBeenCalledWith('old-refresh');
    expect(issueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user,
        scopes: ['profile', 'email'],
        userAgent: 'jest',
        sessionType: 'web_session',
      }),
    );
    expect(auditService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.session.refreshed',
        actorId: 'user-1',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        user: apiUser,
      }),
    );
  });

  it('rejects non-web refresh tokens', async () => {
    jest.spyOn(service, 'findTokenByRefreshToken').mockResolvedValue({
      tokenType: 'oauth_access',
      clientId: 'app_1',
      scopes: '["openid"]',
      user,
    } as never);

    await expect(
      service.refreshWebSession('oauth-refresh', {
        ip: null,
        userAgent: null,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
