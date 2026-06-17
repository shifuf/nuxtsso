import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SessionCookieService } from '../../common/security/session-cookie.service';
import { SetupDto, SetupService } from './setup.service';

@Controller('api/setup')
export class SetupController {
  constructor(
    private readonly setupService: SetupService,
    private readonly sessionCookieService: SessionCookieService,
  ) {}

  @Get('status')
  getStatus() {
    return this.setupService.getStatus();
  }

  @Post()
  async runSetup(
    @Body() dto: SetupDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.setupService.runSetup(dto);
    this.sessionCookieService.setAuthCookies(response, result);
    return result;
  }
}
