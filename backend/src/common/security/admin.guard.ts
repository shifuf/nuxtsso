import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RequestUser } from './request-user.interface';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();

    if (request.user?.role !== 'admin') {
      throw new ForbiddenException('需要管理员权限');
    }

    if (request.user.sessionType !== 'web_session') {
      throw new ForbiddenException('管理接口仅允许站内会话访问');
    }

    return true;
  }
}
