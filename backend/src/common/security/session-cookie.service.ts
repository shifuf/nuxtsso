import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  domain?: string;
  maxAge?: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

@Injectable()
export class SessionCookieService {
  readonly accessCookieName = 'sso_access_token';
  readonly refreshCookieName = 'sso_refresh_token';

  constructor(private readonly configService: ConfigService) {}

  getAccessTokenFromRequest(req: Request) {
    return this.readCookie(req, this.accessCookieName);
  }

  getRefreshTokenFromRequest(req: Request) {
    return this.readCookie(req, this.refreshCookieName);
  }

  setAuthCookies(res: Response, tokens: TokenResponse) {
    const base = this.buildCookieOptions();
    res.cookie(this.accessCookieName, tokens.access_token, {
      ...base,
      maxAge: Math.max(tokens.expires_in, 1) * 1000,
    });

    if (tokens.refresh_token) {
      const refreshMaxAge =
        (this.configService.get<number>('JWT_REFRESH_TOKEN_EXPIRES_IN') ?? 604800) *
        1000;
      res.cookie(this.refreshCookieName, tokens.refresh_token, {
        ...base,
        maxAge: refreshMaxAge,
      });
    }
  }

  clearAuthCookies(res: Response) {
    const options = this.buildCookieOptions();
    res.clearCookie(this.accessCookieName, options);
    res.clearCookie(this.refreshCookieName, options);
  }

  private buildCookieOptions(): CookieOptions {
    const sameSite =
      this.configService.get<'lax' | 'strict' | 'none'>('SESSION_COOKIE_SAMESITE') ??
      'lax';
    const secure =
      this.configService.get<boolean>('SESSION_COOKIE_SECURE') ??
      (this.configService.get<string>('NODE_ENV') === 'production' ||
        sameSite === 'none');
    const domain = this.configService.get<string>('SESSION_COOKIE_DOMAIN')?.trim();

    return {
      httpOnly: true,
      secure,
      sameSite,
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }

  private readCookie(req: Request, name: string) {
    const raw = req.headers.cookie;
    if (!raw) {
      return null;
    }

    for (const part of raw.split(';')) {
      const index = part.indexOf('=');
      if (index < 0) {
        continue;
      }

      const key = part.slice(0, index).trim();
      if (key === name) {
        return decodeURIComponent(part.slice(index + 1));
      }
    }

    return null;
  }
}
