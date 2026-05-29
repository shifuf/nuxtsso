import { Module } from '@nestjs/common';
import { SocialProviderService } from './social-provider.service';

@Module({
  providers: [SocialProviderService],
  exports: [SocialProviderService],
})
export class SocialProviderModule {}
