import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller()
export class HealthController {
  constructor(private readonly configService: ConfigService) {}

  @Get('api/service-info')
  getServiceInfo() {
    const issuer =
      this.configService.get<string>('OIDC_ISSUER') ??
      `http://localhost:${this.configService.get<number>('PORT') ?? 3000}`;

    return {
      name: 'SSO 认证中心',
      status: 'ok',
      issuer,
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
