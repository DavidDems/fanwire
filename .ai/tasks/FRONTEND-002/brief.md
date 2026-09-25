# FRONTEND-002 — authentication against a real Cognito pool

Depends on `FRONTEND-001` being on `main`.

## Why this exists

`FRONTEND-001` ships an `apiClient` whose token provider is a seam with a test
double behind it. Nothing else in the app can be built until a real token comes
out of that seam, because every route except the guest feed needs one.

## Settled, do not re-decide

- **Auth is a real Cognito user pool.** A dev pool locally, `Fanwire-Auth`'s in
  production. Never an emulator, never an in-house fake — that was a human
  decision, recorded in `wiki/GeneralContext/Architecture/dev-auth-setup.md`.
- **The SPA sends the ID token**, not the access token. The backend verifier
  checks `aud` against the client id and rejects an access token outright. This
  has already been a real bug in this repo.
- **`GET /users/me` → 404 means "no profile yet".** It is a routing state, not
  an error. Sign-up creates a Cognito identity; `POST /users` creates the
  application profile, and it requires `username` and `date_of_birth`.
- **Date of birth is private**: the user's own profile and settings only. It
  never appears on a public profile view — the DOB leak was caught once already
  by security review, and the frontend is the second place it can happen.
- **Token storage**: `amazon-cognito-identity-js`'s default `localStorage` is
  accepted for v1. Note the XSS trade-off in the PR body and in the wiki entry.
  Do not invent a cookie backend; that is a separate, larger decision.

## The interface is the point

`AuthService` is an interface, and the Cognito implementation is one
implementation of it. Tests inject a double **of the interface**, not a mock of
`amazon-cognito-identity-js`.

The failure mode this prevents is the usual one: a component that imports the
Cognito SDK directly, a test that mocks the SDK's internals, and a test suite
that then passes while pinning the mock rather than the behaviour. Dependency
inversion, same shape the backend uses for `MalwareScanner` and
`EventPublisher`.

Production code must not branch on environment to choose an implementation.
There is one implementation; configuration differs, code does not.

## Route guard

Three states, and the guard has to tell them apart:

| State | Goes to |
|---|---|
| No session | sign-in, remembering the requested route |
| Session, `GET /users/me` 404 | profile creation |
| Session, `GET /users/me` 200 | the route they asked for |

The third row is what stops profile creation being reachable by a user who
already has a profile.

## Secrets

Pool id and client id are not secrets — they ship in the bundle. They are
per-environment, they live in `frontend/.env.local` (untracked) and in
`src/config.ts`, and they must never be hardcoded, committed, or printed. Tokens
are a different matter: never log one, never render one, never put one in an
error message.

## Verification

msw covers `GET /users/me`, `POST /users` and `GET /events/teams`. It does not
cover Cognito — that is the library's own network, behind the `AuthService`
seam, and the double is what stands in for it.

The real check is a browser, against the real dev pool: sign up, confirm by
email, sign in, land on profile creation, create a profile, land on the feed.
If that was not done, say so plainly in the PR and say why. Do not describe it
as verified.
