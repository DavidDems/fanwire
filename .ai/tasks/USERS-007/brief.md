# USERS-007: sign-up without verification

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Prove first, on the dev pool

The pool signs in by email as the username attribute. Before writing the trigger,
on the dev pool, with a human-provided address:

1. Attach an equivalent trigger (`autoConfirmUser: true`) by hand. This needs the
   human, because agents hold no `cognito-idp:Admin*` (`human-decisions.md` §2).
2. Confirm that sign-in works while `email_verified` is false.
3. Confirm that `GetUserAttributeVerificationCode` then sends a code, and that
   `VerifyUserAttribute` flips it to true.
If step 2 fails, stop and report: the design needs another route.

## Cognito verification client scope

This amendment adds only the frontend Cognito client and its focused test file
to the unit. Keep the proof-first gate above unchanged: implementation still
cannot start until the dev-pool sign-in-with-unverified-email and later
verification proof is completed and recorded.

`CognitoAuthService.requestEmailVerification()` must restore and validate the
current SDK user's session before requesting `GetUserAttributeVerificationCode`,
then make the request on that same hydrated SDK user instance. Do not attempt
the request when no valid session is available. In
`amazon-cognito-identity-js`, the successful callback is
`inputVerificationCode`; resolve the method's Promise there so Account Settings
can move to code entry. Convert SDK/session errors into rejected auth errors
without leaving the Promise pending.

Add focused tests in `CognitoAuthService.test.ts` using the real
`amazon-cognito-identity-js` SDK and the in-process MSW server to intercept
Cognito HTTP. They must never contact a real Cognito pool or network and must
not mock the SDK module (the pinned `auth/sdk-isolation.test.ts` forbids that).
Use only synthetic localStorage session/token fixtures; include no real
credentials or secrets. Cover valid session restoration and request on the same
user; missing or invalid session with no verification request; Promise
completion through `inputVerificationCode`; and rejection on session or SDK
errors. This client/test addition does not alter any other USERS-007 paths,
criteria, gates or sequencing.

## Dedicated pre-sign-up log stream policy scope

The original task acceptance required `iam-policy.test.ts` to remain unchanged.
AWS requires `logs:CreateLogStream` and `logs:PutLogEvents` to target log-stream
resources whose names Lambda generates. The role therefore needs the narrow
resource `${preSignUpLogGroup.logGroupArn}:log-stream:*` under its dedicated
`PreSignUpLogGroup`; a group-wide `:*` is not permitted. The task may now edit
`infra/test/iam-policy.test.ts` only to add one exact, exercised allow-list
entry for that action set and that concrete log-group reference. The rationale
must cite AWS's log-stream resource requirement, the matcher must reject any
broader action or resource, and the existing allow-list hygiene test must prove
the exception matches a synthesized policy. Keep the Lambda role log-only and
keep `permissions-boundary.test.ts` unchanged and passing.

PR #324 is merged to `main`. This scope amendment is PR #326 and must merge
before dependent PR #325.

## Automatic profile creation after sign-in

When a successful sign-in lands on the public feed (`/`), an authenticated
account whose existing `GET /users/me` lookup returns 404 must automatically
continue to `/create-profile`. Keep the feed public for anonymous visitors:
they still see the guest feed and do not make a profile lookup. The existing
404 already distinguishes an authenticated identity without a profile, so do
not add a database column, schema change or boolean. Implement this routing
behavior in `AppLayout.tsx` and cover the actual route flow in
`auth-flow.test.tsx`, including the anonymous feed case. This is the only
additional implementation path for the redirect.

## What this gives up, recorded so it is a choice

- **An unverified account cannot reset its password.** Forgetting the password
  before verifying means losing the account.
- **Anyone can register an address they do not own.** Its real owner then cannot
  sign up with it, and cannot use forgot-password on it, because it is unverified.
  No email is sent either, so the owner is not told. A clean-up job for old
  unverified accounts is a sensible follow-up, not part of this unit.

The human chose this on 2026-11-02 to make sign-up easy for friends and recruiters.
The paragraph above records the historical rationale and risks as they stood
when USERS-007 was specified; it does not require this unit to add reset-limit
copy or document password-recovery behavior. The unit documents the optional
sign-up rule and points to the deferred AUTH tasks below.

## Deferred account-security scope

The 2026-11-02 decision above is preserved as historical context. The current
product direction is to provide reset-link recovery for unverified email
addresses and to challenge verified users on new devices. Those behaviors are
deferred to `AUTH-001`, `AUTH-002` and `AUTH-003`; this unit must not edit or test
forgot-password behavior or add device tracking/login challenges. The native
Cognito recovery limitation remains until `AUTH-001` is completed.

## Why an inline function

Cognito gives a trigger 5 seconds and retries a few times. The shared image is a
large container with a VPC attachment, whose cold start can exceed that. Inline
code in the auth stack has no dependencies and no VPC.

## Deploy

A stack change: the human approves the deploy as usual. The exec policy already
allows `cognito-idp:*` and `lambda:*`.

## Manual steps for the human

The dev pool's trigger, and at least one fresh test address. The brief for this
thread lists them in order.
