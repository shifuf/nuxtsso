import { Body, Controller, Get, Post } from '@nestjs/common';
import { SetupDto, SetupService } from './setup.service';

@Controller('api/setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Get('status')
  getStatus() {
    return this.setupService.getStatus();
  }

  @Post()
  runSetup(@Body() dto: SetupDto) {
    return this.setupService.runSetup(dto);
  }
}
