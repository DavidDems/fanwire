import { useEffect, useState } from "react";

import { useDeactivateAccount, useDeleteAccount } from "../../auth/account";
import { useAuth } from "../../auth/AuthContext";
import { AuthError } from "../../auth/AuthService";
import { Field, describeField } from "../../components/FormField";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import { CircleCheckIcon } from "../../components/ui/icons";
import { focusDeactivatedBanner } from "../../routes/Deactivated";
import styles from "./AccountSettings.module.css";

const PASSWORD_ID = "account-settings-password";
const CODE_ID = "account-settings-verification-code";
const DEACTIVATION_FAILURE_ID = "account-settings-deactivation-failure";
const CODE_FAILURE_ID = "account-settings-verification-code-error";

function authCode(cause: unknown): string | null {
  return cause instanceof AuthError ? cause.code : null;
}

function deactivationMessage(cause: unknown): string {
  const code = authCode(cause);
  if (
    code === "TooManyRequestsException" ||
    code === "TooManyFailedAttemptsException" ||
    code === "LimitExceededException"
  ) {
    return "There have been too many attempts. Please wait and try later.";
  }
  if (code === "NotAuthorizedException") {
    return "That password is incorrect. Please try again.";
  }
  return "We could not deactivate your account just now. Please try again.";
}

function verificationMessage(cause: unknown): string | null {
  const code = authCode(cause);
  if (code === "CodeMismatchException")
    return "That code is incorrect. Check it and try again.";
  if (code === "ExpiredCodeException")
    return "That code has expired. Request a new one and try again.";
  return null;
}

export function AccountSettings() {
  const { authService } = useAuth();
  const deactivate = useDeactivateAccount();
  const deleteAccount = useDeleteAccount();
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [deletionPassword, setDeletionPassword] = useState("");
  const [deletionFailure, setDeletionFailure] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [verificationRequested, setVerificationRequested] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [codeFailure, setCodeFailure] = useState<string | null>(null);
  const [verificationFailure, setVerificationFailure] = useState<string | null>(
    null,
  );
  const [sendingCode, setSendingCode] = useState(false);
  const [confirmingCode, setConfirmingCode] = useState(false);

  const [confirmingDeactivation, setConfirmingDeactivation] = useState(false);
  const [password, setPassword] = useState("");
  const [deactivationFailure, setDeactivationFailure] = useState<string | null>(
    null,
  );
  const [reauthenticating, setReauthenticating] = useState(false);

  useEffect(() => {
    let current = true;
    void authService.emailVerified().then(
      (isVerified) => {
        if (current) setVerified(isVerified);
      },
      () => {
        if (current) {
          setVerified(false);
          setVerificationFailure(
            "We could not check this account's verification status.",
          );
        }
      },
    );
    return () => {
      current = false;
    };
  }, [authService]);

  async function requestVerificationCode(): Promise<void> {
    setVerificationFailure(null);
    setCodeFailure(null);
    setSendingCode(true);
    try {
      await authService.requestEmailVerification();
      setVerificationRequested(true);
    } catch {
      setVerificationFailure(
        "We could not send a verification code. Please try again.",
      );
    } finally {
      setSendingCode(false);
    }
  }

  async function confirmVerificationCode(): Promise<void> {
    const code = verificationCode.trim();
    if (code === "") return;
    setCodeFailure(null);
    setVerificationFailure(null);
    setConfirmingCode(true);
    try {
      await authService.confirmEmailVerification(code);
      await authService.refreshSession();
      const isVerified = await authService.emailVerified();
      if (!isVerified) {
        setCodeFailure(
          "The account is not verified yet. Request a new code and try again.",
        );
        return;
      }
      setVerified(true);
      setVerificationRequested(false);
      setVerificationCode("");
    } catch (cause) {
      const fieldFailure = verificationMessage(cause);
      if (fieldFailure === null) {
        setVerificationFailure(
          "We could not confirm this code. Please try again.",
        );
      } else {
        setCodeFailure(fieldFailure);
      }
    } finally {
      setConfirmingCode(false);
    }
  }

  function closeDeactivation(): void {
    setConfirmingDeactivation(false);
    setPassword("");
    setDeactivationFailure(null);
  }

  async function confirmDeactivation(): Promise<void> {
    if (password.trim() === "") return;
    setDeactivationFailure(null);
    setReauthenticating(true);
    try {
      await authService.reauthenticate(password);
      await deactivate.mutateAsync();
      focusDeactivatedBanner();
    } catch (cause) {
      setDeactivationFailure(deactivationMessage(cause));
    } finally {
      setReauthenticating(false);
    }
  }

  async function confirmDeletion(): Promise<void> {
    if (deletionPassword === "" || deleting) return;
    setDeletionFailure(null);
    setDeleting(true);
    try {
      await authService.reauthenticate(deletionPassword);
      await deleteAccount();
    } catch (cause) {
      setDeletionFailure(
        authCode(cause) === "NotAuthorizedException"
          ? "That password is incorrect. Please try again."
          : "We could not finish deleting your data. Nothing is lost by trying again.",
      );
      setDeleting(false);
    }
  }

  function closeDeletion(): void {
    if (deleting) return;
    setConfirmingDeletion(false);
    setDeletionPassword("");
    setDeletionFailure(null);
  }

  return (
    <div className={styles.page}>
      <h1>Account settings</h1>
      <div className={styles.sections}>
        <Card
          as="section"
          className={styles.section}
          aria-labelledby="verify-account-heading"
        >
          <h2 id="verify-account-heading">Verify this account</h2>
          {verificationFailure === null ? null : (
            <InlineAlert>{verificationFailure}</InlineAlert>
          )}
          {verified === null ? (
            <StatusLine>Checking your verification status…</StatusLine>
          ) : verified ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled
              aria-label="Verified"
              className={styles.verified}
            >
              <CircleCheckIcon aria-hidden="true" />
              Verified
            </Button>
          ) : verificationRequested ? (
            <div className={styles.verification}>
              <Field id={CODE_ID} label="Verification code">
                <input
                  {...describeField(CODE_ID, {
                    error: codeFailure ?? undefined,
                  })}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={verificationCode}
                  onChange={(event) => {
                    setVerificationCode(event.target.value);
                    setCodeFailure(null);
                  }}
                />
              </Field>
              {codeFailure === null ? null : (
                <InlineAlert id={CODE_FAILURE_ID}>{codeFailure}</InlineAlert>
              )}
              <div className={styles.actions}>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  disabled={confirmingCode || verificationCode.trim() === ""}
                  onClick={() => void confirmVerificationCode()}
                >
                  Confirm
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  disabled={sendingCode || confirmingCode}
                  onClick={() => void requestVerificationCode()}
                >
                  Resend code
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={sendingCode}
              onClick={() => void requestVerificationCode()}
            >
              Verify this account
            </Button>
          )}
        </Card>

        <Card
          as="section"
          className={styles.section}
          aria-labelledby="notifications-heading"
        >
          <h2 id="notifications-heading">Notifications</h2>
          <label className={styles.notifications}>
            <input type="checkbox" checked disabled readOnly />
            Notifications
          </label>
          <p className={styles.hint}>On for every account for now</p>
        </Card>

        <Card
          as="section"
          className={styles.section}
          aria-labelledby="deactivate-account-heading"
        >
          <h2 id="deactivate-account-heading">Deactivate account</h2>
          <p>
            Your profile and your posts are hidden from everyone until you
            recover the account, which you can do by signing in again.
          </p>
          <p>
            Posts you deleted one by one stay deleted, even after you recover.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className={styles.deactivate}
            onClick={() => {
              setDeactivationFailure(null);
              setPassword("");
              setConfirmingDeactivation(true);
            }}
          >
            Deactivate account
          </Button>
        </Card>
        <Card
          as="section"
          className={styles.section}
          aria-labelledby="delete-data-heading"
        >
          <h2 id="delete-data-heading">Delete my data</h2>
          <p>
            Permanently remove your account and data. This cannot be undone.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className={styles.deactivate}
            onClick={() => {
              setDeletionPassword("");
              setDeletionFailure(null);
              setConfirmingDeletion(true);
            }}
          >
            Delete my data
          </Button>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmingDeletion}
        title="Delete all your data?"
        confirmLabel="Delete my data"
        destructive
        confirmDisabled={deletionPassword === ""}
        pending={deleting}
        failure={deletionFailure}
        failureId="account-deletion-error"
        onConfirm={() => void confirmDeletion()}
        onCancel={closeDeletion}
      >
        <p>This cannot be undone and recovery is not possible.</p>
        <p>
          Your account, profile, posts, replies, likes, reposts, follows,
          notifications and images will be deleted.
        </p>
        <p>
          Replies other people wrote stay, under an anonymous Post deleted card.
        </p>
        <p>Backup copies expire within 7 days.</p>
        <Field id="account-deletion-password" label="Current password">
          <input
            {...describeField("account-deletion-password")}
            type="password"
            autoComplete="current-password"
            value={deletionPassword}
            disabled={deleting}
            aria-invalid={deletionFailure === null ? undefined : "true"}
            aria-describedby={
              deletionFailure === null ? undefined : "account-deletion-error"
            }
            onChange={(event) => {
              setDeletionPassword(event.target.value);
              setDeletionFailure(null);
            }}
          />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingDeactivation}
        title="Deactivate your account?"
        confirmLabel="Deactivate"
        destructive
        confirmDisabled={password.trim() === ""}
        pending={reauthenticating || deactivate.isPending}
        failure={deactivationFailure}
        failureId={DEACTIVATION_FAILURE_ID}
        onConfirm={() => void confirmDeactivation()}
        onCancel={closeDeactivation}
      >
        <p>
          Your profile and your posts are hidden from everyone until you recover
          the account, which you can do by signing in again.
        </p>
        <p>
          Posts you deleted one by one stay deleted, even after you recover.
        </p>
        <Field id={PASSWORD_ID} label="Current password">
          <input
            {...describeField(PASSWORD_ID)}
            type="password"
            autoComplete="current-password"
            value={password}
            aria-invalid={deactivationFailure === null ? undefined : "true"}
            aria-describedby={
              deactivationFailure === null ? undefined : DEACTIVATION_FAILURE_ID
            }
            onChange={(event) => {
              setPassword(event.target.value);
              setDeactivationFailure(null);
            }}
          />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
