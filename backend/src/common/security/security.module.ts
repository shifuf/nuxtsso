import { Global, Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { RateLimitService } from './rate-limit.service';
import { SecretService } from './secret.service';
import { SessionCookieService } from './session-cookie.service';

@Global()
@Module({
  providers: [
    TokenService,
    JwtAuthGuard,
    AdminGuard,
    SecretService,
    SessionCookieService,
    RateLimitService,
  ],
  exports: [
    TokenService,
    JwtAuthGuard,
    AdminGuard,
    SecretService,
    SessionCookieService,
    RateLimitService,
  ],
})
export class SecurityModule {}
