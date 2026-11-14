module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    // tsconfig's isolatedModules makes ts-jest transpile without type-checking;
    // type-checking is `npm run build`'s job (tsc covers test/ too).
    '^.+\\.tsx?$': 'ts-jest',
  },
  // Synthesizing the full app (including staging the Lambda image context)
  // takes a few seconds per test file.
  testTimeout: 120000,
};
