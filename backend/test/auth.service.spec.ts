import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { AUDIT_ACTIONS } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';

// Pass-through mock: identical behaviour to the real module, but a single
// shared mock instance so compare() calls can be counted across the service
// under test. jest hoists this above the imports above.
jest.mock('bcryptjs', () => {
  const real = jest.requireActual<typeof import('bcryptjs')>('bcryptjs');
  return {
    hash: (s: string, cost: number) => real.hash(s, cost),
    compare: (s: string, hash: string) => real.compare(s, hash),
  };
});
const mockBcrypt = jest.mocked(bcrypt) as unknown as {
  hash: jest.Mock;
  compare: jest.Mock;
};

const JWT_SECRET = 'unit-test-secret-unit-test-secret-0000'; // >= 32 chars

type MockPrisma = {
  user: { findUnique: jest.Mock; create: jest.Mock };
  session: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  auditEvent: { create: jest.Mock };
};

function createPrismaMock(): MockPrisma {
  return {
    user: { findUnique: jest.fn(), create: jest.fn() },
    session: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    auditEvent: { create: jest.fn() },
  } as unknown as MockPrisma;
}

function createService(
  prisma: MockPrisma,
  jwtSecret: string | null = JWT_SECRET,
): { service: AuthService; jwt: JwtService } {
  const jwt = new JwtService({ secret: JWT_SECRET });
  const config = {
    // null (not undefined) means the secret is genuinely unset; passing
    // undefined explicitly would trip the default-parameter fallback.
    get: (key: string) => (key === 'AUTH_JWT_SECRET' ? jwtSecret : undefined),
  } as unknown as ConfigService;
  return { service: new AuthService(prisma as unknown as PrismaService, config, jwt), jwt };
}

function userRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    displayName: 'Alice',
    role: 'PUBLIC',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

async function hashWithCost(password: string, cost = 4): Promise<string> {
  return bcrypt.hash(password, cost);
}

describe('AuthService', () => {
  it('register stores a bcrypt cost-12 hash and returns the public shape', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(({ data }) => Promise.resolve(userRow(data)));
    const { service } = createService(prisma);

    const result = await service.register('Alice@Example.com', 'Alice', 'correct-horse-battery');

    const storedHash = prisma.user.create.mock.calls[0][0].data.passwordHash as string;
    expect(storedHash.startsWith('$2')).toBe(true);
    // Cost-12 cost factor is encoded in the hash prefix.
    expect(storedHash.startsWith('$2b$12$') || storedHash.startsWith('$2y$12$')).toBe(true);
    expect(await bcrypt.compare('correct-horse-battery', storedHash)).toBe(true);
    // Email is lowercased and the response carries no credential fields.
    expect(prisma.user.create.mock.calls[0][0].data.email).toBe('alice@example.com');
    expect(result).toEqual({
      id: 'user-1',
      email: 'alice@example.com',
      role: 'PUBLIC',
      displayName: 'Alice',
    });
    expect('passwordHash' in result).toBe(false);
  });

  it('register rejects a duplicate email case-insensitively', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRow());
    const { service } = createService(prisma);

    await expect(
      service.register('ALICE@example.com', null, 'correct-horse-battery'),
    ).rejects.toThrow('Email already in use');
    expect(prisma.user.create).not.toHaveBeenCalled();
    // The lookup must be against the lowercased email.
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
    });
  });

  it('login with a wrong password still performs a bcrypt comparison (anti-enumeration)', async () => {
    const prisma = createPrismaMock();
    const stored = await hashWithCost('correct-horse-battery');
    prisma.user.findUnique.mockResolvedValue(userRow({ passwordHash: stored }));
    const { service } = createService(prisma);

    const compareSpy = jest.spyOn(mockBcrypt, 'compare');
    await expect(service.login('alice@example.com', 'wrong-password')).rejects.toThrow(
      'Invalid email or password',
    );
    expect(compareSpy).toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
    compareSpy.mockRestore();
  });

  it('login for a non-existent account also performs a bcrypt comparison', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    const { service } = createService(prisma);

    const compareSpy = jest.spyOn(mockBcrypt, 'compare');
    await expect(service.login('nobody@example.com', 'whatever-123')).rejects.toThrow(
      'Invalid email or password',
    );
    expect(compareSpy).toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
    compareSpy.mockRestore();
  });

  it('login success returns both tokens and a public user without passwordHash', async () => {
    const prisma = createPrismaMock();
    const stored = await hashWithCost('correct-horse-battery');
    prisma.user.findUnique.mockResolvedValue(userRow({ passwordHash: stored }));
    prisma.session.create.mockResolvedValue({});
    const { service, jwt } = createService(prisma);

    const result = await service.login('alice@example.com', 'correct-horse-battery');
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toHaveLength(64); // 256-bit hex
    expect(result.user).toEqual({
      id: 'user-1',
      email: 'alice@example.com',
      role: 'PUBLIC',
      displayName: 'Alice',
    });
    expect('passwordHash' in result.user).toBe(false);
    // Only the sha256 of the refresh token is persisted, never the token.
    const created = prisma.session.create.mock.calls[0][0].data;
    expect(created.tokenHash.length).toBe(64);
    expect(created.expiresAt).toBeInstanceOf(Date);
    const payload = await jwt.verifyAsync(result.accessToken, { secret: JWT_SECRET });
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('alice@example.com');
  });

  it('refresh with an unknown token rejects and does not touch sessions', async () => {
    const prisma = createPrismaMock();
    prisma.session.findUnique.mockResolvedValue(null);
    const { service } = createService(prisma);

    await expect(service.refresh('not-a-known-token')).rejects.toThrow('Invalid refresh token');
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it('refresh rejects a revoked session', async () => {
    const prisma = createPrismaMock();
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      tokenHash: 'h',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const { service } = createService(prisma);

    await expect(service.refresh('rotated-away-token')).rejects.toThrow('Invalid refresh token');
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it('refresh revokes the old session by rotating its row in place', async () => {
    const prisma = createPrismaMock();
    const stored = await hashWithCost('correct-horse-battery');
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      tokenHash: 'old-hash',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    prisma.user.findUnique.mockResolvedValue(userRow({ passwordHash: stored }));
    prisma.session.update.mockResolvedValue({});
    const { service } = createService(prisma);

    const result = await service.refresh('old-refresh-token');
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toHaveLength(64);
    // Rotation is conditional on the CURRENT hash: a concurrently rotated
    // session no longer matches and Prisma throws P2025.
    const update = prisma.session.update.mock.calls[0][0];
    expect(update.where).toEqual({ tokenHash: 'old-hash' });
    expect(update.data.tokenHash.length).toBe(64);
    expect(update.data.expiresAt).toBeInstanceOf(Date);
    expect(update.data.revokedAt).toBeUndefined();
    // The rotation is audit-traced with no token material.
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.SESSION_REFRESHED,
        entity: 'session',
        entityId: 'session-1',
        detail: 'rotation',
      },
    });
  });

  it('refresh conflicts when the session rotated concurrently: revokes and rejects generically', async () => {
    const prisma = createPrismaMock();
    const stored = await hashWithCost('correct-horse-battery');
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      tokenHash: 'old-hash',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    prisma.user.findUnique.mockResolvedValue(userRow({ passwordHash: stored }));
    // First update call = the conditional rotation, which loses the race.
    prisma.session.update
      .mockRejectedValueOnce(new Error('P2025: No row matches'))
      .mockResolvedValue({});
    const { service } = createService(prisma);

    await expect(service.refresh('old-refresh-token')).rejects.toThrow(
      'Invalid refresh token',
    );
    // The rotation was attempted against the stale hash...
    expect(prisma.session.update.mock.calls[0][0].where).toEqual({
      tokenHash: 'old-hash',
    });
    // ...and the session was best-effort revoked by id.
    const revocation = prisma.session.update.mock.calls[1][0];
    expect(revocation.where).toEqual({ id: 'session-1' });
    expect(revocation.data.revokedAt).toBeInstanceOf(Date);
    // No audit row is written when the rotation lost the race.
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('logout marks the session revoked', async () => {
    const prisma = createPrismaMock();
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      tokenHash: 'h',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    prisma.session.update.mockResolvedValue({});
    const { service } = createService(prisma);

    await service.logout('old-refresh-token');
    const update = prisma.session.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'session-1' });
    expect(update.data.revokedAt).toBeInstanceOf(Date);
    // Logout is audit-traced with no token material.
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.SESSION_REVOKED,
        entity: 'session',
        entityId: 'session-1',
        detail: 'logout',
      },
    });
  });

  it('logout is a no-op for an unknown refresh token', async () => {
    const prisma = createPrismaMock();
    prisma.session.findUnique.mockResolvedValue(null);
    const { service } = createService(prisma);

    await expect(service.logout('never-issued')).resolves.toBeUndefined();
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it('me returns the public shape and rejects unknown users', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRow({ passwordHash: 'x'.repeat(60) }));
    const { service } = createService(prisma);

    await expect(service.me('user-1')).resolves.toEqual({
      id: 'user-1',
      email: 'alice@example.com',
      role: 'PUBLIC',
      displayName: 'Alice',
    });
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.me('ghost')).rejects.toThrow('Invalid access token');
  });

  it('refuses to issue tokens when AUTH_JWT_SECRET is unset (fail closed)', async () => {
    const prisma = createPrismaMock();
    const stored = await hashWithCost('correct-horse-battery');
    prisma.user.findUnique.mockResolvedValue(userRow({ passwordHash: stored }));
    const { service } = createService(prisma, null);

    await expect(
      service.login('alice@example.com', 'correct-horse-battery'),
    ).rejects.toThrow('AUTH_JWT_SECRET is not configured');
    expect(prisma.session.create).not.toHaveBeenCalled();
  });
});
