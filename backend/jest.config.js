/**
 * Jest configuration for the SENTRAVYN backend UNIT tests.
 *
 * E2E specs (test/e2e/*.e2e-spec.ts) boot the real Nest application module
 * and require a reachable database. They are run separately via
 * `pnpm test:e2e` (test/jest-e2e.json) and are deliberately EXCLUDED here so
 * the unit suite is fast and infrastructure-free.
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
};
