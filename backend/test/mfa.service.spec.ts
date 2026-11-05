import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AUDIT_ACTIONS } from '../src/audit/audit.service';
import { MfaService, sha256Hex } from '../src/auth/mfa/mfa.service';
import * as otplib from 'otplib';
import type { Role } from '@prisma/client';

/**
 * MFA unit tests (docs/SECURITY.md section 2).
 *
 * otplib is mocked so the suite is deterministic and does not depend on real
 * time-based TOTP or the ESM transitive dependency (@scure/base) that the
 * installed otplib 13.x line pulls in. The mock mirrors otplib's observable
 * contract: verify resolves to { valid } for a well-formed input and
 * REJECTS on a corrupt (non-base32) seed; generateSecret/generateURI return
 * strings.
 */
jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  generate: jest.fn(),
  generateSync: jest.fn(),
  verify: jest.fn(),
  verifySync: jest.fn(),
}));
const mockOtp = jest.mocked(otplib);

const JWT_SECRET = 'unit-test-secret-unit-test-secret-0000';

type MockPrisma = {
  user: { findUnique: jest.Mock; update: jest.Mock };
  auditEvent: { create: jest.Mock };
};

function createPrismaMock(): MockPrisma {
  return {
    user: { findUnique: jest.fn(), update: jest.fn() },
    auditEvent: { create: jest.fn() },
  } as unknown as MockPrisma;
}

function createService(
  prisma: MockPrisma,
  opts: { jwtSecret?: string | null; jwtVerifyAsync?: jest.Mock; jwtSign?: jest.Mock } = {},
): MfaService {
  const config = {
    get: (key: string) =>
      key === 'AUTH_JWT_SECRET' ? (opts.jwtSecret === undefined ? JWT_SECRET : opts.jwtSecret) : undefined,
  } as unknown as ConfigService;
  const jwt: JwtService = {
    sign: jest.fn().mockReturnValue('pending-token'),
    verifyAsync: jest
      .fn()
      .mockResolvedValue({ sub: 'user-1', role: 'ADMIN', email: 'a@e.com', purpose: 'sentravyn-mfa' }),
    ...({
      sign: opts.jwtSign,
      verifyAsync: opts.jwtVerifyAsync,
    } as Partial<Record<'sign' | 'verifyAsync', jest.Mock>>),
  } as unknown as JwtService;
  return new MfaService(prisma as unknown as PrismaService, config, jwt);
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    role: 'PUBLIC' as Role,
    email: 'alice@example.com',
    mfaSecret: null as string | null,
    mfaEnabled: false,
    mfaRecoveryCodes: [] as string[],
    ...overrides,
  };
}

/** A valid base32 seed (32 chars) used to simulate otplib's happy path. */
const VALID_SEED = 'BASE32SEEDBASE32SEEDBASE32SEED';
/** A TOTP code that the mock reports as valid. */
const VALID_TOTP = '123456';

function mockPrismaWithUser(prisma: MockPrisma, row: ReturnType<typeof userRow>) {
  prisma.user.findUnique.mockResolvedValue(row);
  prisma.user.update.mockResolvedValue({} as never);
  prisma.auditEvent.create.mockResolvedValue({} as never);
}

describe('MfaService', () => {
  beforeEach(() => {
    mockOtp.generateSecret.mockReturnValue(VALID_SEED);
    mockOtp.generateURI.mockReturnValue(
      `otpauth://totp/SENTRAVYN:user-1?secret=${VALID_SEED}&issuer=SENTRAVYN`,
    );
    // Default: the presented code matches the TOTP seed.
    mockOtp.verify.mockResolvedValue({ valid: true, delta: 0, epoch: 0, timeStep: 0 } as never);
  });

  it('setup issues a seed + 8 recovery codes, stores only hashed codes, and leaves MFA off', async () => {
    const prisma = createPrismaMock();
    mockPrismaWithUser(prisma, userRow());
    const service = createService(prisma);

    const result = await service.setup('user-1');

    expect(result.secret).toBe(VALID_SEED);
    expect(result.uri).toContain('otpauth://totp/');
    expect(result.mfaEnabled).toBe(false);
    expect(result.recoveryCodes).toHaveLength(8);
    // Stored hashes: exactly the sha256 of the 8 plaintext codes (never the codes).
    const expectedHashes = result.recoveryCodes.map((c) => sha256Hex(c));
    const update = prisma.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'user-1' });
    expect(update.data.mfaSecret).toBe(VALID_SEED);
    expect(update.data.mfaRecoveryCodes).toEqual(expectedHashes);
    expect(update.data.mfaEnabled).toBeUndefined(); // not flipped until verify
    // MFA enrolment is audit-traced with no secret material.
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AUDIT_ACTIONS.MFA_SETUP,
          entity: 'user',
          entityId: 'user-1',
        }),
      }),
    );
  });

  it('setup is a no-op error when MFA is already enabled', async () => {
    const prisma = createPrismaMock();
    mockPrismaWithUser(prisma, userRow({ mfaEnabled: true, mfaSecret: VALID_SEED }));
    const service = createService(prisma);

    await expect(service.setup('user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('verifyMfa via a valid TOTP enables the account and reports 8 remaining codes', async () => {
    const prisma = createPrismaMock();
    mockPrismaWithUser(
      prisma,
      userRow({ mfaSecret: VALID_SEED, mfaRecoveryCodes: new Array(8).fill(sha256Hex('x')) }),
    );
    mockOtp.verify.mockResolvedValue({ valid: true, delta: 0, epoch: 0, timeStep: 0 } as never);
    const service = createService(prisma);

    const result = await service.verifyMfa('user-1', VALID_TOTP);

    expect(result.mfaEnabled).toBe(true);
    expect(result.recoveryCodesRemaining).toBe(8);
    // TOTP path does NOT consume a recovery code.
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { mfaEnabled: true },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AUDIT_ACTIONS.MFA_ENABLED,
          detail: 'via-totp',
        }),
      }),
    );
  });

  it('verifyMfa via a recovery code consumes exactly one code', async () => {
    const prisma = createPrismaMock();
    const code = 'ABCDEFGH-IJKLMN-234567';
    const codes = ['other', sha256Hex(code), 'z'].filter(Boolean) as string[];
    mockPrismaWithUser(prisma, userRow({ mfaSecret: VALID_SEED, mfaRecoveryCodes: codes }));
    // TOTP fails, recovery code matches.
    mockOtp.verify.mockResolvedValue({ valid: false, delta: 0, epoch: 0, timeStep: 0 } as never);
    const service = createService(prisma);

    const result = await service.verifyMfa('user-1', code.toUpperCase());

    expect(result.mfaEnabled).toBe(true);
    expect(result.recoveryCodesRemaining).toBe(codes.length - 1);
    // The consumed code's hash is removed from the stored set.
    const codeHash = prisma.user.update.mock.calls[0][0].data.mfaRecoveryCodes as string[];
    expect(codeHash).not.toContain(sha256Hex(code));
    expect(codeHash).toHaveLength(codes.length - 1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ detail: 'via-recovery-code' }),
      }),
    );
  });

  it('verifyMfa rejects a wrong code when no recovery code matches', async () => {
    const prisma = createPrismaMock();
    mockPrismaWithUser(
      prisma,
      userRow({ mfaSecret: VALID_SEED, mfaRecoveryCodes: [sha256Hex('unused')] }),
    );
    mockOtp.verify.mockResolvedValue({ valid: false, delta: 0, epoch: 0, timeStep: 0 } as never);
    const service = createService(prisma);

    await expect(service.verifyMfa('user-1', 'WRONG-WRONG')).rejects.toThrow('Invalid MFA code');
  });

  it('verifyMfa fails closed when the seed is corrupt (non-base32)', async () => {
    const prisma = createPrismaMock();
    mockPrismaWithUser(
      prisma,
      userRow({ mfaSecret: '!!!not-base32!!!', mfaRecoveryCodes: [] }),
    );
    // otplib rejects a corrupt seed with an Invalid Base32 error.
    mockOtp.verify.mockRejectedValue(
      new Error('Invalid Base32 string: Unknown letter "!".'),
    );
    const service = createService(prisma);

    await expect(service.verifyMfa('user-1', VALID_TOTP)).rejects.toThrow('Invalid MFA code');
    // The account is NOT enabled on a corrupt seed.
    expect(prisma.user.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mfaEnabled: true }) }),
    );
  });

  it('verifyMfa requires setup() first (no seed yet)', async () => {
    const prisma = createPrismaMock();
    mockPrismaWithUser(prisma, userRow());
    const service = createService(prisma);
    await expect(service.verifyMfa('user-1', VALID_TOTP)).rejects.toThrow(
      'MFA is not set up for this account',
    );
  });

  it('verifyPending returns the verified subject on a valid pending token + TOTP', async () => {
    const prisma = createPrismaMock();
    mockPrismaWithUser(
      prisma,
      userRow({ role: 'ADMIN', mfaSecret: VALID_SEED, mfaEnabled: true }),
    );
    mockOtp.verify.mockResolvedValue({ valid: true, delta: 0, epoch: 0, timeStep: 0 } as never);
    const service = createService(prisma, {
      jwtVerifyAsync: jest.fn().mockResolvedValue({
        sub: 'user-1',
        role: 'ADMIN',
        email: 'a@e.com',
        purpose: 'sentravyn-mfa',
      }),
    });

    const subject = await service.verifyPending('pending-token', VALID_TOTP);
    expect(subject).toEqual({ id: 'user-1', role: 'ADMIN', email: 'alice@example.com' });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: AUDIT_ACTIONS.MFA_VERIFIED }),
      }),
    );
  });

  it('verifyPending fails closed when MFA is enabled but the seed is missing/corrupt', async () => {
    const prisma = createPrismaMock();
    // enabled=true but mfaSecret=null: the corrupt/degraded case.
    mockPrismaWithUser(prisma, userRow({ role: 'ADMIN', mfaEnabled: true, mfaSecret: null }));
    const service = createService(prisma, {
      jwtVerifyAsync: jest.fn().mockResolvedValue({
        sub: 'user-1',
        role: 'ADMIN',
        email: 'a@e.com',
        purpose: 'sentravyn-mfa',
      }),
    });
    await expect(service.verifyPending('pending-token', VALID_TOTP)).rejects.toThrow(
      'MFA is misconfigured for this account',
    );
  });

  it('verifyPending rejects an invalid or wrong-purpose pending token', async () => {
    const prisma = createPrismaMock();
    mockPrismaWithUser(
      prisma,
      userRow({ role: 'ADMIN', mfaSecret: VALID_SEED, mfaEnabled: true }),
    );
    const service = createService(prisma, {
      // A normal access token (purpose claim absent) must not satisfy MFA.
      jwtVerifyAsync: jest
        .fn()
        .mockResolvedValue({ sub: 'user-1', role: 'ADMIN', email: 'a@e.com' }),
    });
    await expect(service.verifyPending('normal-token', VALID_TOTP)).rejects.toThrow(
      'Invalid MFA pending token',
    );
  });

  it('disableMfa requires a valid second factor and clears the account', async () => {
    const prisma = createPrismaMock();
    mockPrismaWithUser(
      prisma,
      userRow({ mfaSecret: VALID_SEED, mfaEnabled: true, mfaRecoveryCodes: [sha256Hex('x')] }),
    );
    mockOtp.verify.mockResolvedValue({ valid: true, delta: 0, epoch: 0, timeStep: 0 } as never);
    const service = createService(prisma);

    await service.disableMfa('user-1', VALID_TOTP);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { mfaSecret: null, mfaRecoveryCodes: [], mfaEnabled: false },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: AUDIT_ACTIONS.MFA_DISABLED }),
      }),
    );
  });

  it('disableMfa rejects when MFA is not enabled', async () => {
    const prisma = createPrismaMock();
    mockPrismaWithUser(prisma, userRow());
    const service = createService(prisma);
    await expect(service.disableMfa('user-1', VALID_TOTP)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('disableMfa fails closed when enabled but the seed is corrupt', async () => {
    const prisma = createPrismaMock();
    mockPrismaWithUser(prisma, userRow({ mfaEnabled: true, mfaSecret: null }));
    const service = createService(prisma);
    await expect(service.disableMfa('user-1', VALID_TOTP)).rejects.toThrow(
      'MFA is misconfigured for this account',
    );
  });

  it('status reports enabled state + remaining codes, never the seed or codes', async () => {
    const prisma = createPrismaMock();
    mockPrismaWithUser(
      prisma,
      userRow({ mfaSecret: VALID_SEED, mfaEnabled: true, mfaRecoveryCodes: new Array(5).fill('h') }),
    );
    const service = createService(prisma);
    const status = await service.status('user-1');
    expect(status).toEqual({ mfaEnabled: true, recoveryCodesRemaining: 5 });
    expect(JSON.stringify(status)).not.toContain(VALID_SEED);
  });

  it('isPrivilegedRole classifies OPERATOR and ADMIN as privileged', () => {
    expect(MfaService.isPrivilegedRole('OPERATOR')).toBe(true);
    expect(MfaService.isPrivilegedRole('ADMIN')).toBe(true);
    expect(MfaService.isPrivilegedRole('PUBLIC')).toBe(false);
    expect(MfaService.isPrivilegedRole('REVIEWER')).toBe(false);
  });

  it('requiresMfaStep is true only for a privileged, enrolled account', () => {
    const s = createService(createPrismaMock());
    expect(s.requiresMfaStep({ role: 'ADMIN', mfaEnabled: true })).toBe(true);
    expect(s.requiresMfaStep({ role: 'OPERATOR', mfaEnabled: true })).toBe(true);
    expect(s.requiresMfaStep({ role: 'PUBLIC', mfaEnabled: true })).toBe(false);
    expect(s.requiresMfaStep({ role: 'ADMIN', mfaEnabled: false })).toBe(false);
  });

  it('issuePendingToken fails closed when AUTH_JWT_SECRET is unset', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma, { jwtSecret: null });
    await expect(
      service.issuePendingToken({ id: 'user-1', role: 'ADMIN', email: 'a@e.com' }),
    ).rejects.toThrow('AUTH_JWT_SECRET is not configured');
  });
});
