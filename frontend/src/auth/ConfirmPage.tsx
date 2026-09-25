import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { Field, describeField } from "../components/FormField";
import { useAuth } from "./AuthContext";
import { asAuthError, splitFailure, type FieldFailures } from "./errors";

/**
 * Spending the emailed confirmation code.
 *
 * The resend control is the reason `resendConfirmationCode` is on the
 * interface: Cognito's code expires, and without a resend the only recovery is
 * a second account.
 *
 * The address is prefilled from the navigation state sign-up left behind, and
 * stays editable — somebody who arrives from a bookmark, or who mistyped on
 * sign-up, has to be able to say who they are.
 */

type ConfirmField = "email" | "code";

const FIELD_FAILURES: FieldFailures<ConfirmField> = {
  CodeMismatchException: { field: "code", message: "That code is not the one we sent." },
  ExpiredCodeException: {
    field: "code",
    message: "That code has expired. Send yourself a new one.",
  },
  UserNotFoundException: {
    field: "email",
    message: "There is no account for this email address.",
  },
  InvalidParameterException: {
    field: "code",
    message: "That does not look like a confirmation code.",
  },
};

export function ConfirmPage() {
  const { authService } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handedOver = (location.state as { email?: string } | null)?.email;

  const [email, setEmail] = useState(typeof handedOver === "string" ? handedOver : "");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Partial<Record<ConfirmField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset(): void {
    setErrors({});
    setFailure(null);
    setNotice(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    reset();
    setBusy(true);

    try {
      await authService.confirmSignUp({ email, code });
      navigate("/sign-in", { state: { email } });
    } catch (cause) {
      const { fields, alert } = splitFailure(asAuthError(cause), FIELD_FAILURES);
      setErrors(fields);
      setFailure(alert);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend(): Promise<void> {
    reset();
    setBusy(true);

    try {
      await authService.resendConfirmationCode(email);
      setNotice("We have sent another code to that address.");
    } catch (cause) {
      // Nothing the user typed is wrong here — a throttled resend is the one
      // failure on this page that belongs in an alert. Saying nothing is the
      // real defect: the button looks as though it worked.
      setFailure(asAuthError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Confirm your account</h1>

      {failure === null ? null : <p role="alert">{failure}</p>}
      {notice === null ? null : <p role="status">{notice}</p>}

      <form onSubmit={handleSubmit} noValidate>
        <Field id="confirm-email" label="Email" error={errors.email}>
          <input
            {...describeField("confirm-email", { error: errors.email })}
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </Field>

        <Field id="confirm-code" label="Confirmation code" error={errors.code}>
          <input
            {...describeField("confirm-code", { error: errors.code })}
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

        <button type="submit" disabled={busy}>
          Confirm
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void handleResend();
          }}
        >
          Resend code
        </button>
      </form>

      <p>
        <Link to="/sign-in">Back to sign in</Link>
      </p>
    </section>
  );
}
