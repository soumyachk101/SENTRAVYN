/**
 * Jest for @sentravyn/web (Phase 4 map render tests).
 *
 * jsdom + React Testing Library. The MapPanel data layer is pure DOM (a
 * guarded MapLibre init skips when no WebGL canvas is available, which is
 * the jsdom case), so the tests mount the panel and assert on the loading /
 * empty / error / offline states and on the verificationLabel chip, without
 * exercising MapLibre's canvas internals (CLAUDE.md: don't over-test the
 * canvas).
 */
module.exports = {
  testEnvironment: 'jest-environment-jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.{ts,tsx}'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.jest.json',
        diagnostics: false,
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!maplibre-gl)'],
  moduleNameMapper: {
    '\\.(css|less|scss)$': 'identity-obj-proxy',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
