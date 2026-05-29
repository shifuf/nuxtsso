import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { UserModule } from '../user/user.module';
import { ApplicationModule } from '../application/application.module';
import { SocialProviderModule } from '../social-provider/social-provider.module';
import { EmailConfigModule } from '../email-config/email-config.module';
import { BackupModule } from '../backup/backup.module';
import { AuthModule } from '../auth/auth.module';
import { SocialAuthModule } from '../social-auth/social-auth.module';

@Module({
  imports: [
    UserModule,
    ApplicationModule,
    AuthModule,
    SocialProviderModule,
    EmailConfigModule,
    BackupModule,
    SocialAuthModule,
  ],
  controllers: [AdminController],
})
export class AdminModule {}
