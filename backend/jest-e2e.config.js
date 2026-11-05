module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['**/*.e2e-spec.ts'],
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
