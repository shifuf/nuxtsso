import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestUser } from './request-user.interface';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => {
    const request = context.switchToHttp().getRequest();
    return request.user as RequestUser;
  },
);
