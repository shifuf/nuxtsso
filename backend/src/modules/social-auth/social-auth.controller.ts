import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import type { RequestUser } from '../../common/security/request-user.interface';
import { randomBytes } from 'node:crypto';
import { SocialAuthService, SocialBindRequiredError } from './social-auth.service';

class CreateSocialBindDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  returnTo?: string;
}

class CreateSocialLoginQrDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;
}

const CALLBACK_PATH = '/api/auth/callback';

/**
 * Encode provider into state: "{csrf_token}|{provider}"
 * Decode: split by '|' → [csrf, provider]
 */
function encodeState(csrf: string, provider: string) {
  return `${csrf}|${provider}`;
}

function decodeState(state?: string): { csrf: string; provider: string } | null {
  if (!state) return null;
  const idx = state.lastIndexOf('|');
  if (idx <= 0) return null;
  return { csrf: state.slice(0, idx), provider: state.slice(idx + 1) };
}

@Controller('api/auth')
export class SocialAuthController {
  constructor(
    private readonly socialAuthService: SocialAuthService,
    private readonly configService: ConfigService,
  ) {}

  private getFrontendUrl(): string {
    return this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private sendScanResultPage(
    res: Response,
    status: 'success' | 'error',
    title: string,
    message: string,
  ) {
    const color = status === 'success' ? '#16a34a' : '#dc2626';
    const safeTitle = this.escapeHtml(title);
    const safeMessage = this.escapeHtml(message);
    return res
      .type('html')
      .send(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(92vw,420px);border:1px solid rgba(255,255,255,.12);border-radius:24px;padding:28px;background:rgba(15,23,42,.86);box-shadow:0 24px 80px rgba(0,0,0,.28);text-align:center}
    .mark{width:58px;height:58px;margin:0 auto 18px;border-radius:20px;display:grid;place-items:center;background:${color};color:white;font-size:30px;font-weight:800}
    h1{margin:0 0 10px;font-size:22px}
    p{margin:0;color:#94a3b8;line-height:1.8}
  </style>
</head>
<body>
  <main>
    <div class="mark">${status === 'success' ? '✓' : '!'}</div>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
  </main>
</body>
</html>`);
  }

  @UseGuards(JwtAuthGuard)
  @Get('social/bindings')
  listBindings(@CurrentUser() user: RequestUser) {
    return this.socialAuthService.listBindings(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('social/:provider/bind')
  createBindAuthorization(
    @Param('provider') provider: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSocialBindDto,
  ) {
    return this.socialAuthService.createBindAuthorization(
      user.id,
      provider,
      dto.returnTo,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('social/bind-status')
  getBindAuthorizationStatus(
    @CurrentUser() user: RequestUser,
    @Query('state') state: string,
  ) {
    return this.socialAuthService.getBindAuthorizationStatus(user.id, state);
  }

  @Post('social/:provider/login-qr')
  createLoginQrAuthorization(
    @Param('provider') provider: string,
    @Body() dto: CreateSocialLoginQrDto,
  ) {
    return this.socialAuthService.createLoginAuthorization(
      provider,
      dto.clientId,
      dto.redirectUri,
    );
  }

  @Get('social/login-status')
  getLoginQrStatus(@Query('state') state: string) {
    return this.socialAuthService.getLoginAuthorizationStatus(state);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('social/:provider/bind')
  unbind(
    @Param('provider') provider: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.socialAuthService.unbind(user.id, provider);
  }

  @Get('social/:provider')
  async redirectToProvider(
    @Param('provider') provider: string,
    @Query('state') state: string | undefined,
    @Query('client_id') clientId: string | undefined,
    @Query('redirect_uri') redirectUri: string | undefined,
    @Res() res: Response,
  ) {
    try {
      const appContext = clientId && redirectUri
        ? `?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`
        : '';
      const encodedState = encodeState(state ?? randomBytes(16).toString('base64url'), provider);
      const authorizeUrl = await this.socialAuthService.buildAuthorizeRedirect(
        provider,
        `${CALLBACK_PATH}${appContext}`,
        encodedState,
      );
      return res.redirect(authorizeUrl);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '第三方登录不可用';
      return res.redirect(
        `${this.getFrontendUrl()}/login?error=${encodeURIComponent(message)}`,
      );
    }
  }

  /**
   * Unified callback: /api/auth/callback?code=...&state=...|provider
   */
  @Get('callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('client_id') clientId: string | undefined,
    @Query('redirect_uri') redirectUri: string | undefined,
    @Res() res: Response,
  ) {
    const decoded = decodeState(state);
    const provider = decoded?.provider ?? '';

    if (error) {
      const pendingMode = await this.socialAuthService.failAuthorizationState(
        decoded?.csrf,
        provider,
        error,
      );
      if (pendingMode) {
        return this.sendScanResultPage(
          res,
          'error',
          '授权失败',
          '第三方授权未完成，原页面会显示失败状态。现在可以关闭此页面。',
        );
      }
      return res.redirect(
        `${this.getFrontendUrl()}/social/callback?error=${encodeURIComponent(error)}`,
      );
    }

    if (!code || !provider) {
      return res.redirect(
        `${this.getFrontendUrl()}/social/callback?error=${encodeURIComponent('Missing authorization code or provider')}`,
      );
    }

    try {
      const result = await this.socialAuthService.handleCallback(provider, code, decoded?.csrf);

      if (result.mode === 'bind') {
        return this.sendScanResultPage(
          res,
          'success',
          '绑定成功',
          '第三方授权已完成，原页面会自动更新。现在可以关闭此页面。',
        );
      }

      if (result.mode === 'qr_login') {
        return this.sendScanResultPage(
          res,
          'success',
          '登录成功',
          '第三方授权已完成，原登录页会自动进入下一步。现在可以关闭此页面。',
        );
      }

      if (result.mode === 'qr_error') {
        return this.sendScanResultPage(
          res,
          'error',
          '授权失败',
          result.error,
        );
      }

      const params = new URLSearchParams({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        token_type: result.token_type,
        expires_in: String(result.expires_in),
        scope: result.scope,
        user: JSON.stringify(result.user),
      });

      if (clientId) params.set('client_id', clientId);
      if (redirectUri) params.set('redirect_uri', redirectUri);

      return res.redirect(
        `${this.getFrontendUrl()}/social/callback?${params.toString()}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Social login failed';
      const pendingMode = await this.socialAuthService.failAuthorizationState(
        decoded?.csrf,
        provider,
        message,
      );
      if (pendingMode) {
        return this.sendScanResultPage(
          res,
          'error',
          pendingMode === 'bind' ? '绑定失败' : '授权失败',
          '处理第三方授权时发生错误，原页面会显示失败状态。现在可以关闭此页面。',
        );
      }

      // Handle "need bind existing account" flow
      if (err instanceof SocialBindRequiredError) {
        try {
          const pendingState = await this.socialAuthService.createPendingSocialBind(err.socialProfile);
          const params = new URLSearchParams({
            mode: 'need_bind',
            state: pendingState,
          });
          return res.redirect(
            `${this.getFrontendUrl()}/social/callback?${params.toString()}`,
          );
        } catch {
          return res.redirect(
            `${this.getFrontendUrl()}/social/callback?error=${encodeURIComponent('创建绑定会话失败，请重试')}`,
          );
        }
      }

      return res.redirect(
        `${this.getFrontendUrl()}/social/callback?error=${encodeURIComponent(message)}`,
      );
    }
  }

  /**
   * Bind a pending social profile to an existing account.
   * Used when publicApiEnabled is false and user has no bound account.
   */
  @Post('social/bind-existing')
  async bindExisting(
    @Body() dto: { state: string; username: string; password: string },
  ) {
    return this.socialAuthService.bindExistingAccount(
      dto.state,
      dto.username,
      dto.password,
    );
  }

  /**
   * Transfer social binding from current user to another existing account.
   * Used by social-registered users to bind their social account to an existing account.
   */
  @UseGuards(JwtAuthGuard)
  @Post('social/transfer-binding')
  async transferBinding(
    @CurrentUser() user: RequestUser,
    @Body() dto: { provider: string; username: string; password: string },
  ) {
    return this.socialAuthService.transferSocialBinding(
      user.id,
      dto.provider,
      dto.username,
      dto.password,
    );
  }

  /**
   * Backward-compatible: /api/auth/social/:provider/callback → redirect to unified callback
   */
  @Get('social/:provider/callback')
  async handleLegacyCallback(
    @Param('provider') provider: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const state = query.state;
    const encodedState = state ? encodeState(state, provider) : undefined;
    const params = new URLSearchParams(query);
    if (encodedState) params.set('state', encodedState);
    return res.redirect(301, `${CALLBACK_PATH}?${params.toString()}`);
  }
}
