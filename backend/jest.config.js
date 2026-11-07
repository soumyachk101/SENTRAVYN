/**
 * Jest configuration for the SENTRAVYN backend UNIT tests.
 *
 * E2E specs (test/e2e/*.e2e-spec.ts) boot the real Nest application module
 * and require a reachable database. They are run separately via
 * `pnpm test:e2e` (test/jest-e2e.json) and are deliberately EXCLUDED here so
 * the unit suite is fast and infrastructure-free.
 *
 * forceExit: the Redis-backed throttler storage opens a lazy ioredis client
 * whose connection (when REDIS_URL is set) would otherwise hold the Jest
 * process open after tests complete; forceExit matches the e2e config.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/test/e2e/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  forceExit: true,
};
