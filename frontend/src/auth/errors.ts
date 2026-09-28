import { AuthError } from "./AuthService";

/**
 * Error handling the five auth pages share.
 *
 * They all do the same two things with a failure: narrow it to something that
 * carries a provider error code, and decide whether it is about one control or
 * about the whole request. Which code belongs on which control is per-page data
 * — the table lives with the page whose fields it names — but the split is the
 * same everywhere.
 */

/**
 * Narrow whatever `catch` produced to an `AuthError`.
 *
 * Anything that is not one is a defect rather than a rejected credential, so it
 * gets a code no page maps and a message a user can act on. The original is
 * deliberately not unwrapped into the message: an arbitrary thrown value can
 * carry a bearer token in a request URL, and this string is rendered.
 */
export function asAuthError(cause: unknown): AuthError {
  if (cause instanceof AuthError) return cause;
  return new AuthError("UnknownError", "Something went wrong. Please try again.");
}

/** Which control a failure belongs on, and what to say there. */
export interface FieldFailure<Field extends string> {
  field: Field;
  message: string;
}

/** A page's code -> control map. A code that is absent belongs to the page, not to a control. */
export type FieldFailures<Field extends string> = Readonly<Record<string, FieldFailure<Field>>>;

export interface SplitFailure<Field extends string> {
  /** Field-level messages, keyed by control. */
  fields: Partial<Record<Field, string>>;
  /** The message for the page as a whole, or `null` when the failure was about a control. */
  alert: string | null;
}

/**
 * Put a failure where it belongs: on the control it is about, or — for a code
 * the page has no field for, which is nothing the user typed wrongly — in an
 * alert, rather than pretending one of the inputs is at fault.
 */
export function splitFailure<Field extends string>(
  error: AuthError,
  failures: FieldFailures<Field>,
): SplitFailure<Field> {
  const onField = failures[error.code];
  if (onField === undefined) return { fields: {}, alert: error.message };

  const fields: Partial<Record<Field, string>> = {};
  fields[onField.field] = onField.message;
  return { fields, alert: null };
}
