/**
 * `splitFailure` is where every auth page decides what a failure says. A code
 * the page has no field for gets fixed text, never the provider's message:
 * Cognito's own wording can name whether an account exists ("User does not
 * exist."), and a page that renders it leaks what `preventUserExistenceErrors`
 * is set to hide.
 */
import { describe, expect, it } from "vitest";

import { AuthError } from "./AuthService";
import { asAuthError, splitFailure, type FieldFailures } from "./errors";

const GENERIC_FAILURE = "Something went wrong. Please try again.";
const PROVIDER_TEXT = "Provider says: user does not exist";

const FAILURES: FieldFailures<"email" | "password"> = {
  NotAuthorizedException: { field: "password", message: "Wrong password." },
};

describe("splitFailure", () => {
  it("puts a mapped code on its control, with no alert", () => {
    expect(
      splitFailure(new AuthError("NotAuthorizedException", PROVIDER_TEXT), FAILURES),
    ).toEqual({ fields: { password: "Wrong password." }, alert: null });
  });

  it.each(["UserNotFoundException", "InternalErrorException", "MadeUpProviderException"])(
    "gives unmapped %s the fixed generic alert, not the provider's message",
    (code) => {
      expect(splitFailure(new AuthError(code, PROVIDER_TEXT), FAILURES)).toEqual({
        fields: {},
        alert: GENERIC_FAILURE,
      });
    },
  );

  it.each(["LimitExceededException", "TooManyRequestsException"])(
    "gives a throttled %s the fixed too-many-attempts alert",
    (code) => {
      const { fields, alert } = splitFailure(new AuthError(code, PROVIDER_TEXT), FAILURES);
      expect(fields).toEqual({});
      expect(alert).toMatch(/too many attempts/i);
      expect(alert).not.toContain(PROVIDER_TEXT);
    },
  );
});

describe("asAuthError", () => {
  it("wraps a non-AuthError in the same generic message", () => {
    expect(asAuthError(new Error("boom")).message).toBe(GENERIC_FAILURE);
  });
});
