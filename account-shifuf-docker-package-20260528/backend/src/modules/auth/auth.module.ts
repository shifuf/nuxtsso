import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserModule } from '../user/user.module';
import { ApplicationModule } from '../application/application.module';
import { EmailConfigModule } from '../email-config/email-config.module';

@Module({
  imports: [UserModule, ApplicationModule, EmailConfigModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
