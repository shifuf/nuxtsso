import { Module } from '@nestjs/common';
import { SocialAuthController } from './social-auth.controller';
import { SocialAuthService } from './social-auth.service';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [AuthModule, UserModule],
  controllers: [SocialAuthController],
  providers: [SocialAuthService],
  exports: [SocialAuthService],
})
export class SocialAuthModule {}
