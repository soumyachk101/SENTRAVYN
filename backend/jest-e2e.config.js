module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['**/*.e2e-spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(reflect-metadata|@nestjs|@prisma|ioredis)/)'],
  forceExit: true,
};
