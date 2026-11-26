import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Field, describeField } from "../components/FormField";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { InlineAlert } from "../components/ui/InlineAlert";
import { useAuth } from "./AuthContext";
import styles from "./AuthPage.module.css";
import { PASSWORDS_DIFFER, asAuthError } from "./errors";
import { PROFILE_QUERY_KEY } from "./profile";

/**
 * Resetting a forgotten password with the code Cognito emails (AUTH-001).
 *
 * Cognito splits this into two calls — `forgotPassword` sends the code,
 * `confirmForgotPassword` spends it — and they are two steps of one page rather
 * than two routes. The code is only valid for the address that asked for it, so
 * a second route someone could arrive at with a different address in hand is a
 * dead end nobody can debug. The page keeps the address it sent the code to,
 * and step two does not ask for it again.
 *
 * **One answer for every valid address.** The pool prevents user-existence
 * errors, and an account whose email was never verified answers
 * `InvalidParameterException`. After the page's own syntax check, success,
 * that and `UserNotFoundException` all lead to the same next step in the same
 * words, and the page renders none of the provider's own messages, so nothing
 * here says whether an account exists, is verified or was emailed.
 *
 * **Signed out first.** Whoever arrives with a session (Account details'
 * Reset password, or a typed address) is signed out through `AuthContext`
 * before the form renders, and nothing renders while the session is still
 * being restored, so no code is asked for while a session exists.
 */

type ResetField = "email" | "code" | "newPassword" | "confirmPassword";
type ResetErrors = Partial<Record<ResetField, string>>;

/** Shown on the request step before anything is typed, whatever is typed. */
const VERIFIED_ONLY =
  "We send a reset code only to a verified email address, so an account whose email was never verified cannot reset its password this way.";

const INVALID_EMAIL = "Enter an email address, like name@example.com.";
const TOO_MANY_ATTEMPTS =
  "There have been too many attempts. Please wait and try again later.";
const SOMETHING_WENT_WRONG = "Something went wrong. Please try again.";
const WRONG_CODE = "That code is not the one we sent.";

/** The provider's answers on step one that mean "go on to step two". */
const SAME_NEXT_STEP = new Set([
  "UserNotFoundException",
  "InvalidParameterException",
]);
const THROTTLED = new Set([
  "LimitExceededException",
  "TooManyRequestsException",
]);

/**
 * Step two's field failures. An unknown or unverified account never received a
 * code, so whatever code was typed is, truthfully, not the one we sent.
 */
const RESET_FIELD_FAILURES: Readonly<Record<string, [ResetField, string]>> = {
  CodeMismatchException: ["code", WRONG_CODE],
  UserNotFoundException: ["code", WRONG_CODE],
  InvalidParameterException: ["code", WRONG_CODE],
  ExpiredCodeException: [
    "code",
    "That code has expired. Ask for a new one and try again.",
  ],
  InvalidPasswordException: [
    "newPassword",
    "That password does not meet the password rules for this app.",
  ],
};

/** Something, an `@`, something, a dot, something: the syntax check, no more. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** The request alert for a failure no field owns: never the provider's words. */
function alertFor(code: string): string {
  return THROTTLED.has(code) ? TOO_MANY_ATTEMPTS : SOMETHING_WENT_WRONG;
}

export function ForgotPasswordPage() {
  const { authService, status, signOut } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [codeSent, setCodeSent] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<ResetErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    // The same sign-out the shell's does: the session, then what was cached
    // for it, so the next account on this browser reads nothing of this one's.
    signOut();
    queryClient.removeQueries({ queryKey: PROFILE_QUERY_KEY, exact: true });
    void queryClient.resetQueries();
  }, [status, signOut, queryClient]);

  async function handleRequest(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setErrors({});
    setFailure(null);

    const address = email.trim();
    if (!looksLikeEmail(address)) {
      setErrors({ email: INVALID_EMAIL });
      return;
    }

    setEmail(address);
    setBusy(true);
    try {
      await authService.forgotPassword(address);
      setCodeSent(true);
    } catch (cause) {
      const { code: failed } = asAuthError(cause);
      if (SAME_NEXT_STEP.has(failed)) setCodeSent(true);
      else setFailure(alertFor(failed));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});
    setFailure(null);

    if (newPassword !== confirmPassword) {
      setErrors({ confirmPassword: PASSWORDS_DIFFER });
      return;
    }

    setBusy(true);
    try {
      await authService.confirmForgotPassword({ email, code, newPassword });
      navigate("/sign-in", { state: { email } });
    } catch (cause) {
      const { code: failed } = asAuthError(cause);
      const onField = RESET_FIELD_FAILURES[failed];
      if (onField === undefined) setFailure(alertFor(failed));
      else setErrors({ [onField[0]]: onField[1] });
    } finally {
      setBusy(false);
    }
  }

  // Nothing while the session is restored or being signed out: the form
  // exists only for an anonymous visitor.
  if (status !== "anonymous") return <div className={styles.page} />;

  return (
    <div className={styles.page}>
      <Card as="section" className={styles.card}>
        <h1>Forgot password</h1>

        {failure === null ? null : <InlineAlert>{failure}</InlineAlert>}

        {codeSent ? (
          <form onSubmit={handleReset} noValidate>
            <p className={styles.lead}>
              If an account with the verified email address {email} exists, a
              code has been sent to it.
            </p>

            <Field
              id="reset-code"
              label="Confirmation code"
              error={errors.code}
            >
              <input
                {...describeField("reset-code", { error: errors.code })}
                type="text"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                }}
              />
            </Field>

            <Field
              id="reset-new-password"
              label="New password"
              error={errors.newPassword}
            >
              <input
                {...describeField("reset-new-password", {
                  error: errors.newPassword,
                })}
                type="password"
                name="new-password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                }}
              />
            </Field>

            <Field
              id="reset-confirm-password"
              label="Confirm password"
              error={errors.confirmPassword}
            >
              <input
                {...describeField("reset-confirm-password", {
                  error: errors.confirmPassword,
                })}
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                }}
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              size="md"
              className={styles.submit}
              disabled={busy}
            >
              Reset password
            </Button>
          </form>
        ) : (
          <form onSubmit={handleRequest} noValidate>
            <p className={styles.lead}>{VERIFIED_ONLY}</p>

            <Field id="reset-email" label="Email" error={errors.email}>
              <input
                {...describeField("reset-email", { error: errors.email })}
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              size="md"
              className={styles.submit}
              disabled={busy}
            >
              Send code
            </Button>
          </form>
        )}
      </Card>

      <div className={styles.links}>
        <p>
          <Link to="/sign-in">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
