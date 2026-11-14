---
type: decision
---

# 0031 - Launch adjustments

Decision: 2026-11-02, the human.

## Context

Before the site was shared publicly, the human set a list of adjustments to
records, the account menu, history, account settings, sign-up and inviting.
This is the record that [ADR 0007](0007-account-recovery-for-unverified-users.md)
cites as `human-decisions.md` lines 237–239, the sign-up choice below.

## Choice

- **Records:** a library of at least 100 records with search, and sixteen
  featured cards, three to a row on a large screen. A team season shows its
  record (73–9), and every shooting total also has a best-percentage record
  with a minimum number of attempts.
- **Account menu:** "Your profile" leaves the nav. The avatar opens Profile,
  History and Account settings, before Sign out.
- **History:** four tabs: posts, replies, likes, reposts.
- **Account settings:** verify this account (green and inert once verified); a
  notifications setting shown on and disabled, because a real one needs a
  database change (the human's rule); deactivate; and delete my data, a hard
  delete. Both destructive actions ask for the password first.
- **Sign-up without email verification.** Verifying moves to Account settings.
  Accepted with it: an address can be registered by someone who does not own
  it (`USERS-007` brief).
- **Invite:** a button beside compose copies the site's root, the guest feed.

## Consequences

- The sign-up choice was also accepted with "an unverified account cannot
  reset its password". That consequence is superseded.
  [ADR 0007](0007-account-recovery-for-unverified-users.md) chose to give an
  unverified account a reset link, and
  [ADR 0009](0009-account-lifecycle-evidence.md) replaced that choice: native
  Cognito recovery codes to a verified address, with password-reset
  completion held behind its provider-evidence gate. Read those two for the
  current recovery design; this record keeps only the sign-up choice and its
  other accepted risk.
- Account settings and the account menu are
  [0x08k-frontend-account.md](../../CodeContext/Modules/0x08k-frontend-account.md);
  history is [0x08-frontend.md](../../CodeContext/Modules/0x08-frontend.md);
  records are [0x08j-frontend-records.md](../../CodeContext/Modules/0x08j-frontend-records.md);
  sign-up and verification are
  [0x01b-users-auth.md](../../CodeContext/Modules/0x01b-users-auth.md).
