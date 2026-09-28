import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Field, describeField } from "../components/FormField";
import { useAuth } from "./AuthContext";
import { asAuthError, splitFailure, type FieldFailures } from "./errors";

/**
 * Resetting a forgotten password.
 *
 * Cognito splits this into two calls — `forgotPassword` sends the code,
 * `confirmForgotPassword` spends it — and they are two steps of one page rather
 * than two routes. The code is only valid for the address that asked for it, so
 * a second route someone could arrive at with a different address in hand is a
 * dead end nobody can debug. The page keeps the address it sent the code to,
 * and step two does not ask for it again.
 */

type ResetField = "email" | "code" | "newPassword";

/** Step one: the address is the only thing that can be wrong. */
const REQUEST_FAILURES: FieldFailures<ResetField> = {
  UserNotFoundException: {
    field: "email",
    message: "There is no account for this email address.",
  },
  InvalidParameterException: {
    field: "email",
    message: "That does not look like an email address we can use.",
  },
};

/** Step two: the code and the new password are. */
const RESET_FAILURES: FieldFailures<ResetField> = {
  CodeMismatchException: { field: "code", message: "That code is not the one we sent." },
  ExpiredCodeException: {
    field: "code",
    message: "That code has expired. Ask for a new one and try again.",
  },
  InvalidPasswordException: {
    field: "newPassword",
    message: "That password does not meet the password rules for this app.",
  },
};

export function ForgotPasswordPage() {
  const { authService } = useAuth();
  const navigate = useNavigate();

  const [codeSent, setCodeSent] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<ResetField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRequest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});
    setFailure(null);
    setBusy(true);

    try {
      await authService.forgotPassword(email);
      setCodeSent(true);
    } catch (cause) {
      const { fields, alert } = splitFailure(asAuthError(cause), REQUEST_FAILURES);
      setErrors(fields);
      setFailure(alert);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});
    setFailure(null);
    setBusy(true);

    try {
      await authService.confirmForgotPassword({ email, code, newPassword });
      navigate("/sign-in", { state: { email } });
    } catch (cause) {
      const { fields, alert } = splitFailure(asAuthError(cause), RESET_FAILURES);
      setErrors(fields);
      setFailure(alert);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Forgot password</h1>

      {failure === null ? null : <p role="alert">{failure}</p>}

      {codeSent ? (
        <form onSubmit={handleReset} noValidate>
          <p>We have sent a code to {email}.</p>

          <Field id="reset-code" label="Confirmation code" error={errors.code}>
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

          <Field id="reset-new-password" label="New password" error={errors.newPassword}>
            <input
              {...describeField("reset-new-password", { error: errors.newPassword })}
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
              }}
            />
          </Field>

          <button type="submit" disabled={busy}>
            Reset password
          </button>
        </form>
      ) : (
        <form onSubmit={handleRequest} noValidate>
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

          <button type="submit" disabled={busy}>
            Send code
          </button>
        </form>
      )}

      <p>
        <Link to="/sign-in">Back to sign in</Link>
      </p>
    </section>
  );
}
