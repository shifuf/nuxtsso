import { Module } from '@nestjs/common';
import { EmailConfigService } from './email-config.service';

@Module({
  providers: [EmailConfigService],
  exports: [EmailConfigService],
})
export class EmailConfigModule {}
