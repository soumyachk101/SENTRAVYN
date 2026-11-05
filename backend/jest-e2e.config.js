module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['**/*.e2e-spec.ts'],
  // Phase 9: the shared e2e app must not be throttled by the global
  // Redis-backed ThrottlerGuard (parallel suites all hit /auth/* from
  // 127.0.0.1 against one shared Redis). setupFiles run in every worker
  // before spec modules load, so the permissive THROTTLE_* env governs all
  // shared-app boots; the dedicated strict rate-limit test in
  // mfa-sessions.e2e-spec.ts sets its own env on its own app instance.
  setupFiles: ['<rootDir>/test/e2e/throttle-relaxation.setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(reflect-metadata|@nestjs|@prisma|ioredis)/)',
  ],
  // otplib 13.x is ESM-first; its ESM transitive (@scure/base) does not load
  // under the Jest CJS runtime. Map it to a functional RFC 6238 mock
  // (real HMAC-SHA1 TOTP + base32 via node:crypto, cross-checked against the
  // real otplib) so the e2e MFA flow exercises genuine TOTP round-trips.
  // The production runtime (node dist/main.js) loads otplib natively.
  moduleNameMapper: {
    '^otplib$': '<rootDir>/test/mocks/otplib.mock.ts',
  },
  forceExit: true,
};
