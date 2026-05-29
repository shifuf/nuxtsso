import { Global, Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminGuard } from './admin.guard';

@Global()
@Module({
  providers: [TokenService, JwtAuthGuard, AdminGuard],
  exports: [TokenService, JwtAuthGuard, AdminGuard],
})
export class SecurityModule {}
