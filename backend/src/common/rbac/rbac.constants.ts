import { Role } from './roles.decorator';

/**
 * Role privilege hierarchy in ascending order: PUBLIC is the least
 * privileged, ADMIN the most. An OPERATOR's effective roles are
 * OPERATOR + REVIEWER + PUBLIC; ADMIN's effective roles are all four.
 * Used by expandRoles in ../roles.guard.
 */
export const HIERARCHY: readonly Role[] = [
  'PUBLIC',
  'REVIEWER',
  'OPERATOR',
  'ADMIN',
];
