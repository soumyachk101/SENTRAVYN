import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { AUDIT_ACTIONS } from '../src/audit/audit.service';
import { AuthService, AuthTokens } from '../src/auth/auth.service';
import { MfaService } from '../src/auth/mfa/mfa.service';

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
// AuthService now imports MfaService, which in turn imports otplib (the
// installed 13.x line drags in the ESM-only @scure/base). Mock otplib so the
// import chain resolves under the Jest CJS runtime; MfaService itself is
// stubbed at the service boundary in createService(), so these members are
// inert placeholders for this suite.
jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  generate: jest.fn(),
  generateSync: jest.fn(),
  verify: jest.fn(),
  verifySync: jest.fn(),
}));
const mockBcrypt = jest.mocked(bcrypt) as unknown as {
  hash: jest.Mock;
  compare: jest.Mock;
};

const JWT_SECRET = 'unit-test-secret-unit-test-secret-0000'; // >= 32 chars

type MockPrisma = {
  user: { findUnique: jest.Mock; create: jest.Mock };
  session: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  auditEvent: { create: jest.Mock };
};

function createPrismaMock(): MockPrisma {
  return {
    user: { findUnique: jest.fn(), create: jest.fn() },
    session: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    auditEvent: { create: jest.fn() },
  } as unknown as MockPrisma;
}

function createService(
  prisma: MockPrisma,
  jwtSecret: string | null = JWT_SECRET,
  mfa?: MfaService,
): { service: AuthService; jwt: JwtService } {
  const jwt = new JwtService({ secret: JWT_SECRET });
  const config = {
    // null (not undefined) means the secret is genuinely unset; passing
    // undefined explicitly would trip the default-parameter fallback.
    get: (key: string) => (key === 'AUTH_JWT_SECRET' ? jwtSecret : undefined),
  } as unknown as ConfigService;
  // Default MFA stub: no MFA enrolled anywhere in this suite unless a test
  // supplies a real/mock MfaService — keeps the pre-Phase-9 behaviour
  // (everyone gets a full token pair) so existing assertions hold.
  const defaultMfa =
    mfa ??
    ({
      requiresMfaStep: () => false,
      status: async () => ({ mfaEnabled: false, recoveryCodesRemaining: 0 }),
      issuePendingToken: async () => 'pending-token',
      verifyPending: jest.fn(),
    } as unknown as MfaService);
  return {
    service: new AuthService(
      prisma as unknown as PrismaService,
      config,
      jwt,
      defaultMfa,
    ),
    jwt,
  };
}

/** Narrows a login() result to the full-token shape (non-MFA path). */
function tokensOf(result: AuthTokens | { mfaPending: boolean }): AuthTokens {
  if ('mfaPending' in result) {
    throw new Error(
      `expected a token pair, got MFA-pending result: ${JSON.stringify(result)}`,
    );
  }
  return result as AuthTokens;
}

function userRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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
    prisma.user.create.mockImplementation(({ data }) =>
      Promise.resolve(userRow(data)),
    );
    const { service } = createService(prisma);

    const result = await service.register(
      'Alice@Example.com',
      'Alice',
      'correct-horse-battery',
    );

    const storedHash = prisma.user.create.mock.calls[0][0].data
      .passwordHash as string;
    expect(storedHash.startsWith('$2')).toBe(true);
    // Cost-12 cost factor is encoded in the hash prefix.
    expect(
      storedHash.startsWith('$2b$12$') || storedHash.startsWith('$2y$12$'),
    ).toBe(true);
    expect(await bcrypt.compare('correct-horse-battery', storedHash)).toBe(
      true,
    );
    // Email is lowercased and the response carries no credential fields.
    expect(prisma.user.create.mock.calls[0][0].data.email).toBe(
      'alice@example.com',
    );
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
    await expect(
      service.login('alice@example.com', 'wrong-password'),
    ).rejects.toThrow('Invalid email or password');
    expect(compareSpy).toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
    compareSpy.mockRestore();
  });

  it('login for a non-existent account also performs a bcrypt comparison', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    const { service } = createService(prisma);

    const compareSpy = jest.spyOn(mockBcrypt, 'compare');
    await expect(
      service.login('nobody@example.com', 'whatever-123'),
    ).rejects.toThrow('Invalid email or password');
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

    const result = await service.login(
      'alice@example.com',
      'correct-horse-battery',
    );
    const tokens = tokensOf(result);
    expect(tokens.accessToken).toEqual(expect.any(String));
    expect(tokens.refreshToken).toHaveLength(64); // 256-bit hex
    expect(tokens.user).toEqual({
      id: 'user-1',
      email: 'alice@example.com',
      role: 'PUBLIC',
      displayName: 'Alice',
    });
    expect('passwordHash' in tokens.user).toBe(false);
    // Only the sha256 of the refresh token is persisted, never the token.
    const created = prisma.session.create.mock.calls[0][0].data;
    expect(created.tokenHash.length).toBe(64);
    expect(created.expiresAt).toBeInstanceOf(Date);
    const payload = await jwt.verifyAsync(tokens.accessToken, {
      secret: JWT_SECRET,
    });
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('alice@example.com');
  });

  it('refresh with an unknown token rejects and does not touch sessions', async () => {
    const prisma = createPrismaMock();
    prisma.session.findUnique.mockResolvedValue(null);
    const { service } = createService(prisma);

    await expect(service.refresh('not-a-known-token')).rejects.toThrow(
      'Invalid refresh token',
    );
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

    await expect(service.refresh('rotated-away-token')).rejects.toThrow(
      'Invalid refresh token',
    );
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
    prisma.user.findUnique.mockResolvedValue(
      userRow({ passwordHash: 'x'.repeat(60) }),
    );
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

  // ---------------------------------------------------------------- MFA gate

  it('login for a privileged account with MFA enrolled returns a pending MFA token, not a full pair', async () => {
    const prisma = createPrismaMock();
    const stored = await hashWithCost('correct-horse-battery');
    prisma.user.findUnique.mockResolvedValue(
      userRow({ role: 'OPERATOR', passwordHash: stored, mfaEnabled: true }),
    );
    const mfa = {
      requiresMfaStep: jest.fn().mockReturnValue(true),
      status: jest
        .fn()
        .mockResolvedValue({ mfaEnabled: true, recoveryCodesRemaining: 3 }),
      issuePendingToken: jest.fn().mockResolvedValue('mfa-pending'),
      verifyPending: jest.fn(),
    } as unknown as MfaService;
    const { service } = createService(prisma, JWT_SECRET, mfa);

    const result = await service.login(
      'alice@example.com',
      'correct-horse-battery',
    );
    // No session is created on the pending path — only after step 2.
    expect(result).toEqual({
      mfaPending: true,
      mfaTempToken: 'mfa-pending',
      recoveryCodesRemaining: 3,
    });
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('completeMfaLogin verifies the pending token + code and then issues the full token pair', async () => {
    const prisma = createPrismaMock();
    const stored = await hashWithCost('correct-horse-battery');
    prisma.user.findUnique.mockResolvedValue(
      userRow({ role: 'ADMIN', passwordHash: stored, mfaEnabled: true }),
    );
    prisma.session.create.mockResolvedValue({});
    const mfa = {
      requiresMfaStep: () => true,
      status: async () => ({ mfaEnabled: true, recoveryCodesRemaining: 8 }),
      issuePendingToken: async () => 'mfa-pending',
      verifyPending: jest.fn().mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
        email: 'alice@example.com',
      }),
    } as unknown as MfaService;
    const { service } = createService(prisma, JWT_SECRET, mfa);

    const tokens = await service.completeMfaLogin('mfa-pending', '123456');
    expect(tokens.accessToken).toEqual(expect.any(String));
    expect(tokens.refreshToken).toHaveLength(64);
    expect(tokens.user).toMatchObject({ role: 'ADMIN' });
    expect(mfa.verifyPending).toHaveBeenCalledWith('mfa-pending', '123456');
  });

  it('completeMfaLogin fails closed when MfaService rejects the pending token', async () => {
    const prisma = createPrismaMock();
    const mfa = {
      verifyPending: jest
        .fn()
        .mockRejectedValue(new Error('Invalid MFA pending token')),
    } as unknown as MfaService;
    const { service } = createService(prisma, JWT_SECRET, mfa);

    await expect(service.completeMfaLogin('bogus', '123456')).rejects.toThrow(
      'Invalid MFA pending token',
    );
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- sessions

  it('listSessions returns only active sessions, most recent first, without token material', async () => {
    const prisma = createPrismaMock();
    prisma.session.findMany.mockResolvedValue([
      {
        id: 's2',
        userId: 'user-1',
        tokenHash: 'should-not-leak',
        userAgent: 'Mozilla/5.0',
        ip: '10.0.0.1',
        createdAt: new Date('2026-01-02'),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    ]);
    const { service } = createService(prisma);

    const sessions = await service.listSessions('user-1');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('s2');
    expect(sessions[0].userAgent).toBe('Mozilla/5.0');
    // The query excludes revoked/expired rows and orders by createdAt desc,
    // and projects without the stored token hash.
    const call = prisma.session.findMany.mock.calls[0][0];
    expect(call.where).toEqual(
      expect.objectContaining({ userId: 'user-1', revokedAt: null }),
    );
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
    expect(call.select).toBeDefined();
    expect(Object.keys(call.select)).not.toContain('tokenHash');
  });

  it('revokeSession only revokes a session owned by the caller and is idempotent', async () => {
    const prisma = createPrismaMock();
    prisma.session.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'other-user',
      tokenHash: 'h',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    prisma.session.update.mockResolvedValue({});
    const { service } = createService(prisma);

    // A foreign session id is a silent no-op.
    await service.revokeSession('user-1', 's1');
    expect(prisma.session.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();

    // The caller's own session is revoked and audited.
    prisma.session.findUnique.mockResolvedValue({
      id: 's2',
      userId: 'user-1',
      tokenHash: 'h',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await service.revokeSession('user-1', 's2');
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: 's2' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'user-1',
          action: AUDIT_ACTIONS.SESSION_REVOKED,
          detail: 'revoke-session',
        }),
      }),
    );
  });

  it('revokeAllSessions revokes every active session and audits the count', async () => {
    const prisma = createPrismaMock();
    prisma.session.updateMany.mockResolvedValue({ count: 4 });
    const { service } = createService(prisma);

    const count = await service.revokeAllSessions('user-1');
    expect(count).toBe(4);
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'user-1',
          action: AUDIT_ACTIONS.SESSION_REVOKED_ALL,
          detail: 'revoked 4 active session(s)',
        }),
      }),
    );
  });
});
