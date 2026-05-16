import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsString, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AdminGuard } from '../../common/security/admin.guard';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import type { RequestUser } from '../../common/security/request-user.interface';
import { AuthService, SiteConfigDto } from '../auth/auth.service';
import {
  AuditService,
  ClearAuditLogsDto,
  type AuditEntry,
  AuditSummaryQueryDto,
  ListAuditLogsDto,
} from '../audit/audit.service';
import {
  ApplicationService,
  CreateApplicationDto,
  UpdateApplicationDto,
} from '../application/application.service';
import { CreateUserDto, UpdateUserDto, UserService } from '../user/user.service';
import {
  CreateSocialProviderDto,
  SocialProviderService,
  UpdateSocialProviderDto,
} from '../social-provider/social-provider.service';
import {
  EmailConfigService,
  EmailConfigDto,
  type StoredEmailConfig,
  TestEmailConfigDto,
} from '../email-config/email-config.service';
import {
  BackupService,
  RestoreBackupDto,
  type BackupMeta,
  UpdateBackupConfigDto,
} from '../backup/backup.service';
import { SocialAuthService } from '../social-auth/social-auth.service';

class UpdateStatusDto {
  @IsIn(['active', 'disabled'])
  status!: 'active' | 'disabled';
}

class ResetPasswordDto {
  @IsString()
  @MinLength(3)
  newPassword!: string;
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly userService: UserService,
    private readonly applicationService: ApplicationService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly socialProviderService: SocialProviderService,
    private readonly emailConfigService: EmailConfigService,
    private readonly backupService: BackupService,
    private readonly socialAuthService: SocialAuthService,
  ) {}

  private resolveUserAgent(request: Request) {
    const value = request.headers['user-agent'];

    if (Array.isArray(value)) {
      return value.join(', ');
    }

    return value ?? null;
  }

  private async recordAdminAction(
    user: RequestUser,
    request: Request,
    entry: Omit<AuditEntry, 'actorId' | 'actorEmail' | 'ip' | 'userAgent'>,
  ) {
    await this.auditService.create({
      ...entry,
      actorId: user.id,
      actorEmail: user.email,
      ip: request.ip,
      userAgent: this.resolveUserAgent(request),
    });
  }

  @Get('users')
  listUsers(@Query('q') query?: string) {
    return this.userService.listUsers(query);
  }

  @Get('users/search')
  searchUsers(@Query('q') query?: string) {
    return this.userService.searchBindableUsers(query);
  }

  @Get('users/:id')
  getUserById(@Param('id') id: string) {
    return this.userService.getUserById(id);
  }

  @Post('users')
  async createUser(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const createdUser = await this.userService.createUser(dto);
    await this.recordAdminAction(user, request, {
      action: 'admin.user.created',
      targetId: createdUser.id,
      metadata: {
        email: createdUser.email,
        username: createdUser.username,
        role: createdUser.role,
      },
    });
    return createdUser;
  }

  @Put('users/:id')
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const updatedUser = await this.userService.updateUser(id, dto);
    await this.recordAdminAction(user, request, {
      action: 'admin.user.updated',
      targetId: updatedUser.id,
      metadata: {
        username: updatedUser.username,
        role: updatedUser.role,
        emailVerified: updatedUser.emailVerified,
      },
    });
    return updatedUser;
  }

  @Patch('users/:id/status')
  async updateUserStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const updatedUser = await this.userService.updateStatus(id, dto.status);
    await this.recordAdminAction(user, request, {
      action: 'admin.user.status.updated',
      targetId: updatedUser.id,
      metadata: {
        email: updatedUser.email,
        status: updatedUser.status,
      },
    });
    return updatedUser;
  }

  @Post('users/:id/reset-password')
  async resetUserPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const target = await this.userService.getUserById(id);
    const result = await this.userService.resetPassword(id, dto.newPassword);
    const revokedSessions = await this.authService.revokeAllUserSessions(id);
    await this.recordAdminAction(user, request, {
      action: 'admin.user.password_reset',
      targetId: target.id,
      metadata: {
        email: target.email,
        revokedSessions,
      },
    });
    return result;
  }

  @Delete('users/:id')
  async deleteUser(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const deletedUser = await this.userService.getUserById(id);
    const result = await this.userService.deleteUser(id);
    await this.recordAdminAction(user, request, {
      action: 'admin.user.deleted',
      targetId: deletedUser.id,
      metadata: {
        email: deletedUser.email,
        username: deletedUser.username,
      },
    });
    return result;
  }

  @Get('applications')
  listApplications() {
    return this.applicationService.listApplications();
  }

  @Post('applications')
  async createApplication(
    @Body() dto: CreateApplicationDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const application = await this.applicationService.createApplication(dto);
    await this.recordAdminAction(user, request, {
      action: 'admin.application.created',
      targetId: application.id,
      applicationId: application.clientId,
      metadata: {
        name: application.name,
        allowRegistration: application.allowRegistration,
        redirectUris: application.redirectUris,
        scopes: application.scopes,
      },
    });
    return application;
  }

  @Get('applications/:id')
  getApplication(@Param('id') id: string) {
    return this.applicationService.getApplicationById(id);
  }

  @Put('applications/:id')
  async updateApplication(
    @Param('id') id: string,
    @Body() dto: UpdateApplicationDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const application = await this.applicationService.updateApplication(id, dto);
    await this.recordAdminAction(user, request, {
      action: 'admin.application.updated',
      targetId: application.id,
      applicationId: application.clientId,
      metadata: {
        name: application.name,
        allowRegistration: application.allowRegistration,
        redirectUris: application.redirectUris,
        scopes: application.scopes,
      },
    });
    return application;
  }

  @Patch('applications/:id/status')
  async updateApplicationStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const application = await this.applicationService.updateStatus(id, dto.status);
    await this.recordAdminAction(user, request, {
      action: 'admin.application.status.updated',
      targetId: application.id,
      applicationId: application.clientId,
      metadata: {
        name: application.name,
        status: application.status,
      },
    });
    return application;
  }

  @Delete('applications/:id')
  async deleteApplication(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const application = await this.applicationService.getApplicationById(id);
    const result = await this.applicationService.deleteApplication(id);
    await this.recordAdminAction(user, request, {
      action: 'admin.application.deleted',
      targetId: application.id,
      applicationId: application.clientId,
      metadata: {
        name: application.name,
      },
    });
    return result;
  }

  @Get('applications/:id/secret')
  async getApplicationSecret(@Param('id') id: string) {
    return this.applicationService.getApplicationSecret(id);
  }

  @Post('applications/:id/reset-secret')
  async resetSecret(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const application = await this.applicationService.getApplicationById(id);
    const response = await this.applicationService.resetSecret(id);
    await this.recordAdminAction(user, request, {
      action: 'admin.application.secret_reset',
      targetId: application.id,
      applicationId: application.clientId,
      metadata: {
        name: application.name,
      },
    });
    return response;
  }

  @Get('audit-logs')
  listAuditLogs(@Query() query: ListAuditLogsDto) {
    return this.auditService.listLogs(query);
  }

  @Get('audit-logs/summary')
  getAuditSummary(@Query() query: AuditSummaryQueryDto) {
    return this.auditService.getSummary(query);
  }

  @Delete('audit-logs')
  async clearAuditLogs(
    @Body() dto: ClearAuditLogsDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const result = await this.auditService.clearLogs(dto);
    await this.recordAdminAction(user, request, {
      action: 'admin.audit_logs.cleared',
      metadata: {
        olderThanDays: dto.olderThanDays ?? null,
        deletedCount: result.deletedCount,
      },
    });
    return result;
  }

  // ── Social Providers ──

  @Get('social-providers')
  listSocialProviders() {
    return this.socialProviderService.listAll();
  }

  @Post('social-providers/init')
  initSocialProviders() {
    return this.socialProviderService.initDefaults();
  }

  @Post('social-providers')
  async createSocialProvider(
    @Body() dto: CreateSocialProviderDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const provider = await this.socialProviderService.create(dto);
    await this.recordAdminAction(user, request, {
      action: 'admin.social_provider.created',
      metadata: { name: provider.name, type: provider.type },
    });
    return provider;
  }

  @Get('social-providers/:name')
  getSocialProvider(@Param('name') name: string) {
    return this.socialProviderService.getByName(name);
  }

  @Put('social-providers/:name')
  async updateSocialProvider(
    @Param('name') name: string,
    @Body() dto: UpdateSocialProviderDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const provider = await this.socialProviderService.update(name, dto);
    await this.recordAdminAction(user, request, {
      action: 'admin.social_provider.updated',
      metadata: { name: provider.name, enabled: provider.enabled },
    });
    return provider;
  }

  @Delete('social-providers/:name')
  async deleteSocialProvider(
    @Param('name') name: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const result = await this.socialProviderService.delete(name);
    await this.recordAdminAction(user, request, {
      action: 'admin.social_provider.deleted',
      metadata: { name },
    });
    return result;
  }

  // ── Email Config ──

  @Get('email-config')
  getEmailConfig() {
    return this.emailConfigService.getConfig();
  }

  @Put('email-config')
  async updateEmailConfig(
    @Body() dto: EmailConfigDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const config = await this.emailConfigService.updateConfig(dto);
    await this.recordAdminAction(user, request, {
      action: 'admin.email_config.updated',
      metadata: { host: config.host, port: config.port },
    });
    return config;
  }

  @Post('email-config/test')
  testEmailConfig(@Body() dto: TestEmailConfigDto) {
    return this.emailConfigService.testConfig(dto);
  }

  // ── Auth Config ──

  @Get('auth-config')
  getAuthConfig() {
    return this.authService.getAuthConfig();
  }

  @Put('auth-config')
  async updateAuthConfig(
    @Body() dto: { requireEmailVerification: boolean; publicApiEnabled?: boolean },
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const config = await this.authService.updateAuthConfig(dto);
    await this.recordAdminAction(user, request, {
      action: 'admin.auth_config.updated',
      metadata: config,
    });
    return config;
  }

  @Get('site-config')
  getSiteConfig() {
    return this.authService.getSiteConfig();
  }

  @Put('site-config')
  async updateSiteConfig(
    @Body() dto: SiteConfigDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const config = await this.authService.updateSiteConfig(dto);
    await this.recordAdminAction(user, request, {
      action: 'admin.site_config.updated',
      metadata: { ...config },
    });
    return config;
  }

  // ── Backup & Restore ──

  @Get('backups')
  listBackups() {
    return this.backupService.listBackups();
  }

  @Get('backup-config')
  getBackupConfig() {
    return this.backupService.getConfig();
  }

  @Put('backup-config')
  async updateBackupConfig(
    @Body() dto: UpdateBackupConfigDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const config = await this.backupService.updateConfig(dto);
    await this.recordAdminAction(user, request, {
      action: 'admin.backup.config_updated',
      metadata: {
        enabled: config.enabled,
        intervalHours: config.intervalHours,
        retentionCount: config.retentionCount,
        compress: config.compress,
      },
    });
    return config;
  }

  @Post('backups')
  async createBackup(
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const backup = await this.backupService.createBackup();
    await this.recordAdminAction(user, request, {
      action: 'admin.backup.created',
      metadata: {
        filename: backup.filename,
        size: backup.size,
        trigger: backup.trigger,
        compressed: backup.compressed,
      },
    });
    return backup;
  }

  @Post('backups/restore')
  async restoreBackup(
    @Body() dto: RestoreBackupDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const result = await this.backupService.restoreBackup(dto);
    await this.recordAdminAction(user, request, {
      action: 'admin.backup.restored',
      metadata: { filename: dto.filename },
    });
    return result;
  }

  @Delete('backups/:filename')
  async deleteBackup(
    @Param('filename') filename: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const result = await this.backupService.deleteBackup(filename);
    await this.recordAdminAction(user, request, {
      action: 'admin.backup.deleted',
      metadata: { filename },
    });
    return result;
  }

  @Get('backups/:filename/download')
  async downloadBackup(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const streamable = await this.backupService.downloadBackup(filename);
    return streamable;
  }

  // ── Social Accounts ──

  @Get('social-accounts')
  listAllSocialAccounts() {
    return this.userService.listAllSocialAccounts();
  }

  // ── Social Account Binding ──

  @Post('users/:id/social-bind')
  async bindSocialAccount(
    @Param('id') id: string,
    @Body() dto: { provider: string; providerUserId: string; profile?: string },
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const result = await this.userService.bindSocialAccount(id, dto.provider, dto.providerUserId, dto.profile);
    await this.recordAdminAction(user, request, {
      action: 'admin.user.social_bind',
      metadata: { userId: id, provider: dto.provider },
    });
    return result;
  }

  @Delete('users/:id/social-bind/:provider')
  async unbindSocialAccount(
    @Param('id') id: string,
    @Param('provider') provider: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const result = await this.userService.unbindSocialAccount(id, provider);
    await this.recordAdminAction(user, request, {
      action: 'admin.user.social_unbind',
      metadata: { userId: id, provider },
    });
    return result;
  }

  @Post('users/:id/social-bind-url')
  async generateSocialBindUrl(
    @Param('id') id: string,
    @Body() dto: { provider: string },
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const result = await this.socialAuthService.createBindAuthorization(id, dto.provider, '/console/users');
    await this.recordAdminAction(user, request, {
      action: 'admin.user.social_bind_url_generated',
      metadata: { userId: id, provider: dto.provider },
    });
    return result;
  }

  @Get('users/:id/social-bind-status')
  getSocialBindStatus(
    @Param('id') id: string,
    @Query('state') state: string,
  ) {
    return this.socialAuthService.getBindAuthorizationStatus(id, state);
  }

  @Post('users/:id/transfer-social-to')
  async transferSocialBindings(
    @Param('id') id: string,
    @Body() dto: { targetUsername: string },
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const result = await this.userService.transferSocialBindings(id, dto.targetUsername);
    await this.recordAdminAction(user, request, {
      action: 'admin.user.social_transfer',
      metadata: { sourceUserId: id, targetUsername: dto.targetUsername, transferred: result.transferred },
    });
    return result;
  }

}
