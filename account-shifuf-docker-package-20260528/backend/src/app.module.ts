import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { SecurityModule } from './common/security/security.module';
import { AuditModule } from './modules/audit/audit.module';
import { UserModule } from './modules/user/user.module';
import { ApplicationModule } from './modules/application/application.module';
import { AuthModule } from './modules/auth/auth.module';
import { Oauth2Module } from './modules/oauth2/oauth2.module';
import { AdminModule } from './modules/admin/admin.module';
import { SetupModule } from './modules/setup/setup.module';
import { SocialAuthModule } from './modules/social-auth/social-auth.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    SecurityModule,
    AuditModule,
    UserModule,
    ApplicationModule,
    AuthModule,
    Oauth2Module,
    AdminModule,
    SetupModule,
    SocialAuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
