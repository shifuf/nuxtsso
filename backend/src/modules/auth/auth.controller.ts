import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import type { RequestUser } from '../../common/security/request-user.interface';
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

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly auditService: AuditService,
  ) {}

  private resolveUserAgent(request: Request) {
    const value = request.headers['user-agent'];
    return Array.isArray(value) ? value.join(', ') : value ?? null;
  }

  @Post('send-email-code')
  sendEmailCode(@Body() dto: SendEmailCodeDto, @Req() request: Request) {
    return this.authService.sendEmailCode(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.authService.login(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('login-email')
  loginEmail(@Body() dto: LoginEmailDto, @Req() request: Request) {
    return this.authService.loginByEmailCode(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('register')
  register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.authService.register(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto, @Req() request: Request) {
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
  ) {
    const result = await this.authService.revokeUserSession(
      user.id,
      id,
      user.token,
    );

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
    return {
      requireEmailVerification: config.requireEmailVerification,
      publicApiEnabled: config.publicApiEnabled,
    };
  }

  @Post('public-register')
  publicRegister(@Body() dto: PublicRegisterDto, @Req() request: Request) {
    return this.authService.publicRegister(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }
}
