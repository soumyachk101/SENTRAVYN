import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Roles, ROLE_VALUES, Role } from '../src/common/rbac/roles.decorator';
import { RolesGuard, expandRoles } from '../src/common/rbac/roles.guard';

describe('RBAC (expandRoles + RolesGuard)', () => {
  const guard = new RolesGuard();

  function routeHandler(roles?: Role[]): () => unknown {
    const handler = () => {};
    if (roles) {
      Roles(...roles)(handler);
    }
    return handler;
  }

  function makeContext(
    handler: () => unknown,
    user?: { role: Role },
  ): ExecutionContext {
    const request = user !== undefined ? { user } : {};
    return {
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  describe('expandRoles (ROLE_HIERARCHY)', () => {
    it('expands PUBLIC to just PUBLIC', () => {
      expect(expandRoles('PUBLIC')).toEqual(['PUBLIC']);
    });

    it('expands OPERATOR to OPERATOR + REVIEWER + PUBLIC', () => {
      expect(expandRoles('OPERATOR')).toEqual([
        'PUBLIC',
        'REVIEWER',
        'OPERATOR',
      ]);
    });

    it('expands ADMIN to all four roles', () => {
      expect(expandRoles('ADMIN')).toEqual([
        'PUBLIC',
        'REVIEWER',
        'OPERATOR',
        'ADMIN',
      ]);
    });
  });

  describe('RolesGuard.canActivate', () => {
    it('allows a route without @Roles metadata', async () => {
      expect(await guard.canActivate(makeContext(routeHandler()))).toBe(true);
    });

    it('allows an OPERATOR caller on a route that permits REVIEWER (hierarchy)', async () => {
      const ctx = makeContext(routeHandler(['REVIEWER']), {
        role: 'OPERATOR',
      });
      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('allows an ADMIN caller on any role-gated route', async () => {
      const ctx = makeContext(routeHandler(['OPERATOR']), { role: 'ADMIN' });
      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('rejects a PUBLIC caller on a REVIEWER-gated route with a ForbiddenException', async () => {
      const ctx = makeContext(routeHandler(['REVIEWER']), { role: 'PUBLIC' });
      let caught: unknown;
      try {
        await guard.canActivate(ctx);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).message).toBe('insufficient role');
    });

    it('rejects a missing user on a role-gated route with authentication-required', async () => {
      const ctx = makeContext(routeHandler(['ADMIN']));
      let caught: unknown;
      try {
        await guard.canActivate(ctx);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).message).toBe(
        'authentication required for privileged operation',
      );
    });
  });

  describe('Roles metadata placement (method-decorator regression)', () => {
    // TypeScript applies method decorators as
    // factory(target.prototype, 'name', descriptor), and Nest routes its
    // ExecutionContext.getHandler() to the descriptor's value function.
    // The old @Roles (bare Reflect.metadata factory) stored its list on
    // (prototype, 'name'), which the guard never reads: in a real request
    // the metadata was invisible and every role check degraded to
    // "allow any authenticated request". This test pins the real
    // write/read placement so that bypass cannot resurface.
    it('metadata written as a real method decorator is enforced by the guard', async () => {
      class AdminOnlyController {
        list(): unknown {
          return 'audit events';
        }
      }
      Roles('ADMIN')(
        AdminOnlyController.prototype,
        'list',
        Object.getOwnPropertyDescriptor(AdminOnlyController.prototype, 'list')!,
      );
      const ctx = makeContext(
        AdminOnlyController.prototype.list as () => unknown,
        { role: 'PUBLIC' },
      );
      let caught: unknown;
      try {
        await guard.canActivate(ctx);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).message).toBe('insufficient role');

      const allowedCtx = makeContext(
        AdminOnlyController.prototype.list as () => unknown,
        { role: 'ADMIN' },
      );
      expect(await guard.canActivate(allowedCtx)).toBe(true);
    });
  });

  describe('Role union stays in sync with the Prisma Role enum', () => {
    const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');
    const schema = readFileSync(schemaPath, 'utf8');
    const match = schema.match(/enum\s+Role\s*\{([^}]*)\}/);
    const prismaRoleValues = match ? match[1].split(/\s+/).filter(Boolean) : [];

    it('reads exactly the documented Prisma Role values', () => {
      expect(prismaRoleValues).toEqual([
        'PUBLIC',
        'REVIEWER',
        'OPERATOR',
        'ADMIN',
      ]);
    });

    it('matches the Role union values exported by the RBAC layer', () => {
      expect([...ROLE_VALUES]).toEqual(prismaRoleValues);
    });
  });
});
