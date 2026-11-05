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

Add focused tests in `CognitoAuthService.test.ts` that mock the Cognito SDK
boundary, never contact a real pool, and cover: valid session restoration and
request on the same user; missing or invalid session without a verification
request; Promise completion through `inputVerificationCode`; and rejection on
SDK errors. Do not include real credentials, token values or verification codes
in fixtures or diagnostics. This client/test addition does not alter any other
USERS-007 paths, criteria, gates or sequencing.

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
