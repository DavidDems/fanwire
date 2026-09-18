module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    // Type-checking is `npm run build`'s job (tsc covers test/ too); skipping
    // it here keeps each test file's compile fast.
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
  },
  // Synthesizing the full app (including staging the Lambda image context)
  // takes a few seconds per test file.
  testTimeout: 120000,
};
