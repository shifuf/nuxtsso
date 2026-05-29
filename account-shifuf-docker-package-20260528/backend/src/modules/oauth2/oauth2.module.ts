import { Module } from '@nestjs/common';
import { Oauth2Controller } from './oauth2.controller';
import { Oauth2Service } from './oauth2.service';
import { AuthModule } from '../auth/auth.module';
import { ApplicationModule } from '../application/application.module';

@Module({
  imports: [AuthModule, ApplicationModule],
  controllers: [Oauth2Controller],
  providers: [Oauth2Service],
})
export class Oauth2Module {}
