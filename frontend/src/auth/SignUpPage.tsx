import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Field, describeField } from "../components/FormField";
import { useAuth } from "./AuthContext";
import { asAuthError, splitFailure, type FieldFailures } from "./errors";

/**
 * Creating the Cognito identity.
 *
 * Sign-up creates the *identity* and nothing else: `POST /users` creates the
 * application profile, and that is `ProfileSetupPage`, reached after the
 * account is confirmed and signed in. So all this page owes is the call and the
 * step Cognito says comes next.
 */

type SignUpField = "email" | "password";

/**
 * Which control each Cognito failure is about. A code that is not here is about
 * the request rather than about something the user typed, and goes to an alert.
 */
const FIELD_FAILURES: FieldFailures<SignUpField> = {
  UsernameExistsException: {
    field: "email",
    message: "An account already exists for this email address.",
  },
  InvalidParameterException: {
    field: "email",
    message: "That does not look like an email address we can use.",
  },
  InvalidPasswordException: {
    field: "password",
    message: "That password does not meet the password rules for this app.",
  },
};

export function SignUpPage() {
  const { authService } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<SignUpField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});
    setFailure(null);
    setSubmitting(true);

    try {
      const { userConfirmed } = await authService.signUp({ email, password });

      // A pool with email verification answers `false` and emails a code.
      // Carrying the address over means the user does not retype what they
      // just typed; an already-confirmed account has nothing to confirm.
      if (userConfirmed) {
        navigate("/sign-in", { state: { email } });
      } else {
        navigate("/confirm", { state: { email } });
      }
    } catch (cause) {
      const { fields, alert } = splitFailure(asAuthError(cause), FIELD_FAILURES);
      setErrors(fields);
      setFailure(alert);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h1>Sign up</h1>

      {failure === null ? null : <p role="alert">{failure}</p>}

      <form onSubmit={handleSubmit} noValidate>
        <Field id="sign-up-email" label="Email" error={errors.email}>
          <input
            {...describeField("sign-up-email", { error: errors.email })}
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </Field>

        <Field id="sign-up-password" label="Password" error={errors.password}>
          <input
            {...describeField("sign-up-password", { error: errors.password })}
            type="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>

        <button type="submit" disabled={submitting}>
          Sign up
        </button>
      </form>

      <p>
        <Link to="/sign-in">Already have an account?</Link>
      </p>
    </section>
  );
}
