import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Role, ROLES_METADATA_KEY } from './roles.decorator';
import { HIERARCHY } from './rbac.constants';

// Intended integration: attach RolesGuard globally via APP_GUARD (chosen so
// that privileged routes are fail-closed) or route-level @UseGuards
// (RolesGuard). Either way it must run AFTER the auth layer's
// JwtAuthGuard (backend/src/auth/guards/jwt-auth.guard.ts), which populates
// request.user. This guard does not import that guard; it only reads
// request.user. The lead wires the guard up in app.module.ts.
//
// ROLE_HIERARCHY: ADMIN implies all privileges; OPERATOR implies
// OPERATOR + REVIEWER + PUBLIC (see HIERARCHY in rbac.constants.ts).

/**
 * Grants a caller the roles at and below their granted role in the
 * privilege hierarchy. expandRoles('PUBLIC') = ['PUBLIC'],
 * expandRoles('ADMIN') = all four roles.
 */
export function expandRoles(role: Role): Role[] {
  const idx = HIERARCHY.indexOf(role);
  if (idx === -1) {
    return [];
  }
  return HIERARCHY.slice(0, idx + 1);
}

/**
 * Enforces @Roles metadata on the route handler.
 *
 * - No @Roles metadata on the route -> allow (public route).
 * - request.user (set upstream by JwtAuthGuard) missing or without a role
 *   -> ForbiddenException('authentication required for privileged operation').
 * - Caller's effective role (granted role plus all junior roles per the
 *   hierarchy) satisfies any allowed role -> allow.
 * - Otherwise -> ForbiddenException('insufficient role').
 */
export class RolesGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const allowed = Reflect.getMetadata(ROLES_METADATA_KEY, handler) as
      | Role[]
      | undefined;
    if (!allowed || allowed.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest() as {
      user?: { role: Role };
    };
    const user = request.user;
    if (!user || !user.role) {
      throw new ForbiddenException(
        'authentication required for privileged operation',
      );
    }

    const effective = expandRoles(user.role);
    if (allowed.some((role) => effective.includes(role))) {
      return true;
    }
    throw new ForbiddenException('insufficient role');
  }
}
