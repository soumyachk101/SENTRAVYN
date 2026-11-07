/**
 * Role union for SENTRAVYN's RBAC layer.
 *
 * MUST stay in sync with the Prisma `Role` enum
 * (backend/prisma/schema.prisma). This layer is intentionally
 * dependency-free (no @prisma/client import), so the sync is enforced by
 * the jest test in backend/test/rbac.spec.ts, which asserts the two sets
 * match.
 */
export type Role = 'PUBLIC' | 'REVIEWER' | 'OPERATOR' | 'ADMIN';

/**
 * Ordered list of the Role values (source of truth for the Prisma enum
 * sync test). Keep in lockstep with the Prisma `Role` enum.
 */
export const ROLE_VALUES: readonly Role[] = [
  'PUBLIC',
  'REVIEWER',
  'OPERATOR',
  'ADMIN',
];

/** Reflect metadata key under which @Roles stores its allowed-role list. */
export const ROLES_METADATA_KEY = 'sentravyn:roles';

/**
 * Marks a route handler with the roles permitted to invoke it.
 *
 * Metadata is written on the target the guard can read it back from: for a
 * method decorator that is `descriptor.value` (the handler function, i.e.
 * `ExecutionContext.getHandler()`); for a plain-function call (unit tests,
 * class-level use) it is written on the target itself. This mirrors
 * @nestjs/common `SetMetadata` semantics.
 *
 * Apply on route handlers. RolesGuard reads only handler-level metadata,
 * so class-level application is not enforced by the guard.
 *
 * Do not implement this with the bare `Reflect.metadata(key, value)`
 * factory: as a method decorator it stores on `(prototype, propertyKey)`,
 * which the guard never reads, so every role check silently degrades to
 * "allow any authenticated request" (authorization bypass).
 */
export const Roles =
  (...roles: Role[]) =>
  (
    target: object,
    _propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ): PropertyDescriptor | object => {
    if (descriptor !== undefined) {
      Reflect.defineMetadata(ROLES_METADATA_KEY, roles, descriptor.value);
      return descriptor;
    }
    Reflect.defineMetadata(ROLES_METADATA_KEY, roles, target);
    return target;
  };
