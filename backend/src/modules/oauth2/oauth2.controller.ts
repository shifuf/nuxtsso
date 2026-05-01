import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import type { RequestUser } from '../../common/security/request-user.interface';
import {
  AuthorizeDecisionDto,
  AuthorizeQueryDto,
  Oauth2Service,
  TokenRequestDto,
} from './oauth2.service';

@Controller()
export class Oauth2Controller {
  constructor(private readonly oauth2Service: Oauth2Service) {}

  @Get('/.well-known/openid-configuration')
  getConfiguration() {
    return this.oauth2Service.getDiscoveryDocument();
  }

  @Get('/oauth2/jwks')
  getJwks() {
    return this.oauth2Service.getJwks();
  }

  @Get('/oauth2/authorize')
  getAuthorizeMetadata(@Query() query: AuthorizeQueryDto) {
    return this.oauth2Service.getAuthorizeMetadata(query);
  }

  @Post('/oauth2/validate-client')
  validateClient(@Body() dto: { client_id: string; client_secret: string }) {
    return this.oauth2Service.validateClient(dto.client_id, dto.client_secret);
  }

  @UseGuards(JwtAuthGuard)
  @Post('/oauth2/authorize')
  authorize(
    @CurrentUser() user: RequestUser,
    @Body() dto: AuthorizeDecisionDto,
  ) {
    return this.oauth2Service.authorize(user, dto);
  }

  @Post('/oauth2/token')
  exchangeToken(@Body() dto: TokenRequestDto) {
    return this.oauth2Service.exchangeToken(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/oauth2/userinfo')
  getUserInfo(@CurrentUser() user: RequestUser) {
    return this.oauth2Service.getUserInfo(user);
  }
}
