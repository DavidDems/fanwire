import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'cdk.out/', '**/*.js', '**/*.d.ts', '!eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // CDK constructs are instantiated for their side effects (`new Foo(this, ...)`).
      'no-new': 'off',
    },
  },
);
