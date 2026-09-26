/**
 * FRONTEND-002 acceptance criteria 1 and 2 — the seam itself.
 *
 * `AuthService` is the interface every page, hook and guard depends on. The
 * Cognito SDK is one implementation of it and nothing else in `src/` is allowed
 * to know that (pinned from disk in `sdk-isolation.test.ts`).
 *
 * Two things are pinned here. The *shape* of the interface is a compile-time
 * property, so it is pinned by making the test double satisfy it — a missing
 * method fails `npm run typecheck`, and the runtime loop below fails the suite
 * for anyone who reads test output before typecheck output.
 *
 * `AuthError` is the other half. Cognito failures are translated at the seam, so
 * a page can branch on `code` (`UsernameExistsException`, `CodeMismatchException`,
 * …) without importing the SDK to do it. It has to be a real `Error` subclass:
 * `throw`n across an async boundary, caught by a page, and readable in a stack
 * trace.
 */
import { describe, expect, it } from "vitest";

import { FakeAuthService, testSession } from "../test/auth";
import { AuthError } from "./AuthService";
import type { AuthService, AuthSession } from "./AuthService";

/** Criterion 2 names all nine by name. */
const SURFACE = [
  "signUp",
  "confirmSignUp",
  "resendConfirmationCode",
  "signIn",
  "signOut",
  "forgotPassword",
  "confirmForgotPassword",
  "refreshSession",
  "getIdToken",
] as const;

describe("the AuthService interface", () => {
  it("names every operation the auth pages need", () => {
    // Typed as the interface on purpose: this only compiles if `FakeAuthService`
    // implements the whole surface, and only passes if the names match.
    const service: AuthService = new FakeAuthService();
    const methods = service as unknown as Record<string, unknown>;

    for (const method of SURFACE) {
      expect(typeof methods[method], `AuthService.${method} is missing`).toBe("function");
    }
  });

  it("carries only the id token and the email on a session", () => {
    // Nothing else belongs in the session object: a refresh token or an access
    // token held here is a token that ends up rendered or logged by accident,
    // and the SPA sends the *ID* token and nothing else.
    const session: AuthSession = testSession();

    expect(Object.keys(session).sort()).toEqual(["email", "idToken"]);
  });
});

describe("AuthError", () => {
  it("is a real Error carrying Cognito's error name as its code", () => {
    const error = new AuthError("UsernameExistsException", "An account already exists.");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe("UsernameExistsException");
    expect(error.message).toBe("An account already exists.");
  });

  it("is named, so a stack trace and a logger both say what it is", () => {
    expect(new AuthError("NotAuthorizedException", "Incorrect password.").name).toBe("AuthError");
  });

  it("survives being thrown across an async boundary with its code intact", async () => {
    // A page catches this from `await service.signIn(...)` and branches on
    // `code`. If the subclass loses its prototype (the classic transpiled
    // `extends Error` bug) the branch silently stops matching.
    const service = new FakeAuthService().failWith("signIn", "NotAuthorizedException");

    await expect(service.signIn({ email: "a@b.test", password: "x" })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(service.signIn({ email: "a@b.test", password: "x" })).rejects.toMatchObject({
      code: "NotAuthorizedException",
    });
  });
});
