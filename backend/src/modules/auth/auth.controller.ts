import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { RateLimitService } from '../../common/security/rate-limit.service';
import type { RequestUser } from '../../common/security/request-user.interface';
import { SessionCookieService } from '../../common/security/session-cookie.service';
import { ApplicationService, CreateApplicationDto } from '../application/application.service';
import { AuditService } from '../audit/audit.service';
import {
  BindPhoneDto,
  UpdateCurrentUserDto,
  UserService,
} from '../user/user.service';
import {
  AuthService,
  LoginDto,
  LoginEmailDto,
  PublicRegisterDto,
  RegisterDto,
  ResetPasswordDto,
  SendEmailCodeDto,
} from './auth.service';

const AVATAR_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly applicationService: ApplicationService,
    private readonly auditService: AuditService,
    private readonly sessionCookieService: SessionCookieService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  private resolveUserAgent(request: Request) {
    const value = request.headers['user-agent'];
    return Array.isArray(value) ? value.join(', ') : value ?? null;
  }

  private resolveRequestIp(request: Request) {
    const forwardedFor = request.headers['x-forwarded-for'];
    const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return value?.split(',')[0]?.trim() || request.ip || request.socket.remoteAddress || 'unknown';
  }

  private consumeAuthLimit(
    request: Request,
    action: string,
    subject: string,
    limit: number,
    windowMs: number,
  ) {
    const ip = this.resolveRequestIp(request);
    this.rateLimitService.consume(`${action}:ip:${ip}`, limit, windowMs);
    this.rateLimitService.consume(
      `${action}:subject:${subject.toLowerCase()}`,
      limit,
      windowMs,
    );
    this.rateLimitService.cleanup();
  }

  private sniffImageMime(buffer: Buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }

    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'image/png';
    }

    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }

    if (
      buffer.length >= 6 &&
      (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
        buffer.subarray(0, 6).toString('ascii') === 'GIF89a')
    ) {
      return 'image/gif';
    }

    return null;
  }

  @Post('send-email-code')
  sendEmailCode(@Body() dto: SendEmailCodeDto, @Req() request: Request) {
    this.consumeAuthLimit(
      request,
      'send-email-code',
      dto.email,
      5,
      10 * 60 * 1000,
    );
    return this.authService.sendEmailCode(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.consumeAuthLimit(request, 'login', dto.username, 10, 10 * 60 * 1000);
    const result = await this.authService.login(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    this.sessionCookieService.setAuthCookies(response, result);
    return result;
  }

  @Post('login-email')
  async loginEmail(
    @Body() dto: LoginEmailDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.consumeAuthLimit(request, 'login-email', dto.email, 8, 10 * 60 * 1000);
    const result = await this.authService.loginByEmailCode(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    this.sessionCookieService.setAuthCookies(response, result);
    return result;
  }

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.consumeAuthLimit(
      request,
      'register',
      dto.email ?? dto.username ?? 'anonymous',
      5,
      10 * 60 * 1000,
    );
    const result = await this.authService.register(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    this.sessionCookieService.setAuthCookies(response, result);
    return result;
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto, @Req() request: Request) {
    this.consumeAuthLimit(
      request,
      'reset-password',
      dto.email,
      5,
      10 * 60 * 1000,
    );
    return this.authService.resetPassword(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('session')
  getSession(@CurrentUser() user: RequestUser) {
    return this.authService.getSession(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('account/sessions')
  listSessions(@CurrentUser() user: RequestUser) {
    return this.authService.listUserSessions(user.id, user.token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.revokeAccessToken(user.token);
    this.sessionCookieService.clearAuthCookies(response);
    return { success: true };
  }

  @Post('refresh')
  async refresh(
    @Body() dto: { refreshToken?: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken =
      dto?.refreshToken ?? this.sessionCookieService.getRefreshTokenFromRequest(request);

    if (!refreshToken) {
      throw new BadRequestException('缺少刷新令牌');
    }

    const result = await this.authService.refreshWebSession(refreshToken, {
      ip: this.resolveRequestIp(request),
      userAgent: this.resolveUserAgent(request),
    });
    this.sessionCookieService.setAuthCookies(response, result);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Delete('account/sessions')
  async revokeOtherSessions(
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const result = await this.authService.revokeOtherUserSessions(
      user.id,
      user.token,
    );

    await this.auditService.create({
      action: 'auth.sessions.revoked_others',
      actorId: user.id,
      actorEmail: user.email,
      ip: request.ip,
      userAgent: this.resolveUserAgent(request),
      metadata: {
        revokedCount: result.revokedCount,
      },
    });

    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Delete('account/sessions/:id')
  async revokeSession(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.revokeUserSession(
      user.id,
      id,
      user.token,
    );

    if (result.current) {
      this.sessionCookieService.clearAuthCookies(response);
    }

    await this.auditService.create({
      action: 'auth.session.revoked',
      actorId: user.id,
      actorEmail: user.email,
      ip: request.ip,
      userAgent: this.resolveUserAgent(request),
      metadata: {
        sessionId: id,
        current: result.current,
      },
    });

    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Put('account/profile')
  async updateProfile(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateCurrentUserDto,
    @Req() request: Request,
  ) {
    const updatedUser = await this.userService.updateCurrentUser(user.id, dto);

    await this.auditService.create({
      action: 'auth.profile.updated',
      actorId: user.id,
      actorEmail: user.email,
      ip: request.ip,
      userAgent: this.resolveUserAgent(request),
      metadata: {
        username: updatedUser.username,
        avatar: updatedUser.avatar,
      },
    });

    return updatedUser;
  }

  @UseGuards(JwtAuthGuard)
  @Post('account/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (
        _request: Request,
        file: { mimetype: string },
        callback: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
          callback(new BadRequestException('仅支持 JPG、PNG、WebP 或 GIF 头像'), false);
          return;
        }

        callback(null, true);
      },
    }),
  )
  async uploadAvatar(
    @CurrentUser() user: RequestUser,
    @UploadedFile()
    file: {
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    },
    @Req() request: Request,
  ) {
    if (!file) {
      throw new BadRequestException('请上传头像文件');
    }

    const detectedMime = this.sniffImageMime(file.buffer);
    if (!detectedMime || detectedMime !== file.mimetype) {
      throw new BadRequestException('头像文件内容与图片类型不匹配');
    }

    const extension = AVATAR_EXTENSIONS[detectedMime];
    const directory = join(process.cwd(), 'uploads', 'avatars');
    const filename = `${user.id}-${Date.now()}-${randomBytes(6).toString('hex')}${extension}`;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, filename), file.buffer);

    const avatar = `/uploads/avatars/${filename}`;
    const updatedUser = await this.userService.updateAvatar(user.id, avatar);

    await this.auditService.create({
      action: 'auth.avatar.uploaded',
      actorId: user.id,
      actorEmail: user.email,
      ip: request.ip,
      userAgent: this.resolveUserAgent(request),
      metadata: { avatar, size: file.size, mimetype: file.mimetype },
    });

    return updatedUser;
  }

  @UseGuards(JwtAuthGuard)
  @Get('account/applications')
  listOwnApplications(@CurrentUser() user: RequestUser) {
    return this.applicationService.listUserApplications(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('account/applications')
  async createOwnApplication(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateApplicationDto,
    @Req() request: Request,
  ) {
    const application = await this.applicationService.createApplicationForOwner(
      dto,
      user.id,
    );

    await this.auditService.create({
      action: 'auth.application.created',
      actorId: user.id,
      actorEmail: user.email,
      applicationId: application.clientId,
      ip: request.ip,
      userAgent: this.resolveUserAgent(request),
      metadata: {
        name: application.name,
        redirectUris: application.redirectUris,
        scopes: application.scopes,
      },
    });

    return application;
  }

  @UseGuards(JwtAuthGuard)
  @Put('account/phone')
  async bindPhone(
    @CurrentUser() user: RequestUser,
    @Body() dto: BindPhoneDto,
    @Req() request: Request,
  ) {
    const updatedUser = await this.userService.bindPhone(user.id, dto.phone);

    await this.auditService.create({
      action: 'auth.phone.bound',
      actorId: user.id,
      actorEmail: user.email,
      ip: request.ip,
      userAgent: this.resolveUserAgent(request),
      metadata: {
        phone: updatedUser.phone,
      },
    });

    return updatedUser;
  }

  @UseGuards(JwtAuthGuard)
  @Delete('account/phone')
  async unbindPhone(
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const updatedUser = await this.userService.unbindPhone(user.id);

    await this.auditService.create({
      action: 'auth.phone.unbound',
      actorId: user.id,
      actorEmail: user.email,
      ip: request.ip,
      userAgent: this.resolveUserAgent(request),
    });

    return updatedUser;
  }

  @UseGuards(JwtAuthGuard)
  @Put('account/set-password')
  async setPassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: { password: string },
    @Req() request: Request,
  ) {
    const updatedUser = await this.authService.setPasswordForSocialUser(user.id, dto.password);

    await this.auditService.create({
      action: 'auth.password.set',
      actorId: user.id,
      actorEmail: user.email,
      ip: request.ip,
      userAgent: this.resolveUserAgent(request),
    });

    return updatedUser;
  }

  @Get('social-providers')
  getSocialProviders(@Query('clientId') clientId?: string) {
    return this.authService.getSocialProviders(clientId);
  }

  @Get('config')
  async getPublicAuthConfig() {
    const config = await this.authService.getAuthConfig();
    const site = await this.authService.getSiteConfig();
    return {
      requireEmailVerification: config.requireEmailVerification,
      publicApiEnabled: config.publicApiEnabled,
      site,
    };
  }

  @Get('site-config')
  getSiteConfig() {
    return this.authService.getSiteConfig();
  }

  @Post('public-register')
  async publicRegister(
    @Body() dto: PublicRegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.consumeAuthLimit(
      request,
      'public-register',
      dto.email ?? dto.username ?? 'anonymous',
      5,
      10 * 60 * 1000,
    );
    const result = await this.authService.publicRegister(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    this.sessionCookieService.setAuthCookies(response, result);
    return result;
  }
}
