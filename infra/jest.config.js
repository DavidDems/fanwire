module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  // Synthesizing the full app (including staging the Lambda image context)
  // takes a few seconds per test file.
  testTimeout: 120000,
};
