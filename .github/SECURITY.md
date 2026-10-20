# Security policy

## Reporting a vulnerability

Report it privately at
<https://github.com/DavidDems/fanwire/security/advisories/new>
(the repository's **Security** tab → **Report a vulnerability**). Only the
maintainer sees it there.

Please don't open a public issue, pull request or discussion about it.

A useful report says what is affected (a file, an endpoint, a workflow), how
to reproduce it, and what an attacker gains.

## Scope

- The application code in this repository and the deployed app it builds.
- The CI workflows and the automated agent system that build this
  repository, including anything that lets untrusted input reach a
  credential, write to `main`, or widen what an automated run may change.

Only the current `main` branch is supported; there are no released versions.

## What to expect

This is a one-maintainer project. Reports are read and answered on a
best-effort basis, there is no bug bounty, and a fix is credited to you in the
advisory unless you ask otherwise.
