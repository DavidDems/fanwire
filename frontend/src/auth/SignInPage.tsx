import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { Field, describeField } from "../components/FormField";
import { useAuth } from "./AuthContext";
import { asAuthError, splitFailure, type FieldFailures } from "./errors";

/**
 * Signing in, and delivering the visitor where they were going.
 *
 * `RequireAuth` remembers the route an anonymous visitor asked for, in
 * `location.state.from`; this page is what takes them there. Landing everyone
 * on the feed afterwards is the defect — they clicked "Notifications", not
 * "Feed".
 *
 * The call goes through `useAuth().signIn` rather than the service directly, so
 * that the one call both authenticates and updates the session the guards read.
 */

type SignInField = "email" | "password";

const FIELD_FAILURES: FieldFailures<SignInField> = {
  NotAuthorizedException: {
    field: "password",
    message: "That password is not right for this account.",
  },
  UserNotFoundException: {
    field: "email",
    message: "There is no account for this email address.",
  },
  PasswordResetRequiredException: {
    field: "password",
    message: "This account has to reset its password before signing in.",
  },
};

/** Where the guard was sending them, or the feed when nothing was interrupted. */
function requestedRoute(state: unknown): string {
  const from = (state as { from?: { pathname?: string; search?: string } } | null)?.from;
  if (typeof from?.pathname !== "string" || from.pathname === "") return "/";
  return `${from.pathname}${from.search ?? ""}`;
}

export function SignInPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<SignInField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});
    setFailure(null);
    setSubmitting(true);

    try {
      await signIn({ email, password });
      navigate(requestedRoute(location.state), { replace: true });
    } catch (cause) {
      const error = asAuthError(cause);

      // Not an error: the credentials were right and the address was never
      // confirmed, the same way a 404 from `GET /users/me` is a routing state.
      // A field-level message here dead-ends the only account they have.
      if (error.code === "UserNotConfirmedException") {
        navigate("/confirm", { state: { email } });
        return;
      }

      const { fields, alert } = splitFailure(error, FIELD_FAILURES);
      setErrors(fields);
      setFailure(alert);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h1>Sign in</h1>

      {failure === null ? null : <p role="alert">{failure}</p>}

      <form onSubmit={handleSubmit} noValidate>
        <Field id="sign-in-email" label="Email" error={errors.email}>
          <input
            {...describeField("sign-in-email", { error: errors.email })}
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </Field>

        <Field id="sign-in-password" label="Password" error={errors.password}>
          <input
            {...describeField("sign-in-password", { error: errors.password })}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>

        <button type="submit" disabled={submitting}>
          Sign in
        </button>
      </form>

      <p>
        <Link to="/forgot-password">Forgotten your password?</Link>
      </p>
      <p>
        <Link to="/sign-up">Create an account</Link>
      </p>
    </section>
  );
}
