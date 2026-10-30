# FRONTEND-025: the frontend test harness on Node 26

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Renovate PR #202 moves the Node runtime to 26. Its `frontend-test` fails 11
tests in 4 files: `harness.test.ts`, `MediaWidget.test.tsx`,
`app-wiring.test.tsx` and `CognitoAuthService.test.ts`. The first two are the
`File` problem and the last two are the `localStorage` problem. msw 3 and
jsdom 30 do not fix it, so no dependency changes.

## Root cause

- **`File`.** From undici 7 (Node 24 on), `Request.formData()` builds each part
  with the global `File`, read at call time, so jsdom's. It then asserts
  `webidl.is.File`, an `instanceof` against the `File` undici captured when it
  loaded, which is Node's: vitest's jsdom environment loads undici before it
  installs jsdom's globals. A `Symbol.hasInstance` cannot answer that check,
  only the prototype chain can.
- **The rewrap.** `append(key, nodeFile, name)` rewraps through the bare `File`,
  which is jsdom's, so the part body becomes the text `[object File]`.
- **`localStorage`.** Node 26 defines its own global, `undefined` without
  `--localstorage-file`. Vitest copies a jsdom key only when the global does not
  already have it. A flag cannot turn Node's off, because the Node 20 image
  rejects it.

## The fix

Local copy, checked against main when this spec was written:
`.worktrees/_ledger/item13-fix.patch` in the main checkout. It is untracked, so
the criteria carry the substance. In `setupTests.ts`, after the reader shims (if
inherited first, Node's readers look present, the shims stand down, and Node's
throw on a jsdom `this`):

```ts
const jsdomEnvironment = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
if (jsdomEnvironment !== undefined) {
  Object.setPrototypeOf(Blob.prototype, NodeFile.prototype);
  // then, for localStorage and sessionStorage, when the global is undefined:
  // defineProperty(globalThis, key, { value: jsdomEnvironment.window[key], configurable: true, writable: true })
}
```

## Test-first on the wrong Node

CI runs Node 20 until #202 lands, and the failures only appear on Node 26.
- **Red anywhere:** `new File([], "a.txt") instanceof NodeFile`. This is the test
  commit's red and it pins the `setupTests.ts` prototype change.
- **Cannot be red on Node 20 or 22:** the storage assertions, and the rewrap's
  bytes. They are green on main there. They guard regressions, and the Node 26
  runs are their proof. Say so in the test commit's message.

## Traps

- **Who may write what.** `code_agent` is denied `frontend/src/test/**`, and
  `test_agent` cannot write `setupTests.ts`. So `form-data-file-names.ts` goes in
  the **test** commit with the harness tests, and `setupTests.ts` alone is the
  implementation commit. The prototype test stays red across the test commit,
  because that assertion depends only on `setupTests.ts`.
- **The patch was verified on targeted files only** (Node 26, 22, 20). Hence the
  full-suite run on the #202 preview. `docker/**` is not writable here: make a
  throwaway local merge, build the image, run `frontend-test`, remove it.
- **The `jsdom` guard is load-bearing.** A `@vitest-environment node` file also
  runs this setup, and there `Blob` is Node's own, so the prototype chain would
  be a cycle.
- `prettier --write` on named files only.

## Not in this task

Merging or rebasing #202; any Node version change in a Dockerfile or workflow.
