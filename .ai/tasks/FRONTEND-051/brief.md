# FRONTEND-051: load the Cognito SDK lazily

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 5, deliverable 1 (`Prompts/34`, ADR 0035), and the backlog row "The entry is
near its raw limit". The entry is 554,756 B raw / 172,741 B gzip (measured on the
integration tip 028b493, after the FRONTEND-050 fold) against the 560,300 B raw
ceiling ADR 0041 set. That is under 1% headroom, so the next nav item or shell change
can't land. The largest thing in it that the first paint doesn't need is the Cognito
SDK (`amazon-cognito-identity-js`, its `buffer` polyfill and its `@aws-crypto`
dependencies). The Director's prototype, a dynamic import of `CognitoAuthService`,
brought the entry to about 464,180 B raw / 146,809 B gzip, with a new lazy chunk
`CognitoAuthService` of about 26,421 B gzip. A small `config` chunk joins the entry
closure; it's part of the entry and needs no declaration.

## Decision (Director's): a deferring `AuthService`, chosen in `App.tsx`

A new `frontend/src/auth/DeferredAuthService.ts` exports `DeferredAuthService`, which
implements `AuthService` and takes a loader `() => Promise<AuthService>`.

- It starts the load in its constructor, so session restore begins at module load as
  it does today, and the SDK arrives in parallel with the first render.
- Every async method awaits the loaded service and delegates, with arguments and result
  unchanged. A rejection from the inner service (an `AuthError`) passes through as the
  same object.
- `signOut()` stays synchronous (the interface says nothing should await it). It calls
  the loaded service at once if the load has resolved; otherwise it signs out as soon
  as the load resolves.
- A failed load rejects the calls waiting on it and isn't cached: the next call
  retries the loader. A chunk dropped on a flaky network shouldn't leave the tab
  unable to sign in until a reload.

`App.tsx` stays the one place that picks the implementation:

```ts
const authService = new DeferredAuthService(() =>
  import("./auth/CognitoAuthService").then((m) => new m.CognitoAuthService()),
);
```

It still names `CognitoAuthService`, which `auth/app-wiring.test.tsx` checks.
`CognitoAuthService.ts` doesn't change and stays the only file importing the SDK
(`auth/sdk-isolation.test.ts`). `installTokenProvider` and `AuthProvider` get the
deferred service unchanged. Pages, hooks and guards still see only `AuthService`.

## The unit

- **Red first.** Write `DeferredAuthService.test.ts` with a fake inner `AuthService`
  and a controllable loader. It pins:
  - each of the twelve async methods delegating, with its arguments and result;
  - the loader called once at construction, and not again after a success;
  - `signOut` before and after the load;
  - a failed load, then a retry, then success;
  - an inner `AuthError` reaching the caller unchanged.

  Add `bundle-budgets/FRONTEND-051.ts` with `added: { CognitoAuthService: N }`, where N
  is the measured gzip rounded up to the next 100 B. Tests are frozen after the test
  commit, so measure on the implementation, then declare N in the test commit. If you
  add the optional structural check (the built entry closure holds no
  `amazon-cognito-identity-js` code), it goes in `auth/cognito-lazy.test.ts` and
  nowhere else.
- **Implementation.** Write `DeferredAuthService.ts` and make the `App.tsx` change
  above: drop the static import, and keep the "one place" comment, updated.
- **Docs.** Update `0x08b-frontend-auth.md` as the last criterion says.
- **PR.** Record the entry's raw and gzip sizes after the unit, measured with the
  test's build.

## Traps

- `prettier --write` on named files only: a glob also matches committed tests.
- `bundle-budgets/FRONTEND-051.ts` is under `src/test/**`, so it's a `test_agent`
  commit and goes in with the failing tests.
- Run the frontend suite alone, in the foreground, sharded. A killed suite proves
  nothing. A second production build in `cognito-lazy.test.ts` doubles the suite's
  build cost, so if you write it, keep it to one `build()`.
- The `define: { global: "globalThis" }` in `vite.config.ts` must keep covering the
  lazy chunk. The `buffer` polyfill is what reads Node's bare `global`, and it now
  lives in `CognitoAuthService`'s chunk. `bundle-budget.test.ts`'s bare-global check
  scans every chunk, so a regression shows there. In the browser it shows only once
  the SDK loads, so browser-check sign-in after the change, not only the cold feed.
- Don't touch `CognitoAuthService.ts`, `tokenProvider.ts` or `AuthContext.tsx`. If the
  deferred service can't be made to fit them unchanged, stop and report.

## Amendment (Director, after the unit measured)

The split also makes `src/auth/AuthService.ts` (the `AuthError` class, about 139 B gzip) a
lazy chunk of its own: once `CognitoAuthService` is no longer static, nothing in the entry
imports it as code, so Rolldown shares it between the auth pages, `AccountSettings` and the
Cognito chunk. That is the split working, not a leak, so the unit declares it too:
`added: { CognitoAuthService: N, AuthService: 200 }`. Pinning it back into the entry with
an import that exists only for that would be the hack.
