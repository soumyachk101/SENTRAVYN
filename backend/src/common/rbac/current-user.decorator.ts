import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from './roles.decorator';

/** Authenticated user shape placed on the request by the auth layer. */
export interface AuthUser {
  id: string;
  role: Role;
  email: string;
}

/**
 * Injects the authenticated user into a route handler parameter:
 *
 * @example
 * Get('me')
 * profile(@CurrentUser() user: AuthUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest() as {
      user?: AuthUser;
    };
    return request.user as AuthUser;
  },
);
