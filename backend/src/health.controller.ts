import { Controller, Get } from '@nestjs/common';
import { TokenService } from './common/security/token.service';
import { AuthService } from './modules/auth/auth.service';

@Controller()
export class HealthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  @Get('api/service-info')
  async getServiceInfo() {
    const site = await this.authService.getSiteConfig();

    return {
      name: site.siteName,
      status: 'ok',
      issuer: this.tokenService.getIssuer(),
      docs: [
        '/.well-known/openid-configuration',
        '/oauth2/authorize',
        '/oauth2/token',
        '/oauth2/userinfo',
        '/api/auth/login',
      ],
    };
  }

  @Get('api/health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
