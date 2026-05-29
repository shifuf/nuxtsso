import { Module } from '@nestjs/common';
import { SocialAuthController } from './social-auth.controller';
import { SocialAuthService } from './social-auth.service';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { ApplicationModule } from '../application/application.module';

@Module({
  imports: [AuthModule, UserModule, ApplicationModule],
  controllers: [SocialAuthController],
  providers: [SocialAuthService],
  exports: [SocialAuthService],
})
export class SocialAuthModule {}
