import { UnauthorizedException } from '@nestjs/common';

jest.mock('../../common/security/token.service', () => ({
  TokenService: class TokenService {},
}));

import { Oauth2Service } from './oauth2.service';
import type { RequestUser } from '../../common/security/request-user.interface';

describe('Oauth2Service', () => {
  const prismaService = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const requestUser = (scopes: string[]): RequestUser => ({
    id: 'user-1',
    email: 'neo@example.com',
    role: 'user',
    scopes,
    clientId: 'app_1',
    token: 'access-token',
    audience: 'app_1',
    sessionType: 'oauth_access',
  });

  let service: Oauth2Service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new Oauth2Service(
      prismaService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('limits userinfo claims to granted scopes', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'neo',
      displayName: 'Neo',
      email: 'neo@example.com',
      emailVerified: false,
      avatar: '/uploads/avatars/neo.png',
    });

    await expect(service.getUserInfo(requestUser(['openid']))).resolves.toEqual({
      sub: 'user-1',
    });

    await expect(
      service.getUserInfo(requestUser(['openid', 'profile', 'email'])),
    ).resolves.toEqual({
      sub: 'user-1',
      name: 'Neo',
      preferred_username: 'neo',
      picture: '/uploads/avatars/neo.png',
      email: 'neo@example.com',
      email_verified: false,
    });
  });

  it('rejects userinfo when the user no longer exists', async () => {
    prismaService.user.findUnique.mockResolvedValue(null);

    await expect(service.getUserInfo(requestUser(['openid']))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
