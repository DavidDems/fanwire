/**
 * The authentication seam: an interface, the session it hands back, and the one
 * error type a page is allowed to branch on.
 *
 * Every page, hook and guard in the app depends on `AuthService` and on nothing
 * below it. The Cognito implementation is one implementation of this interface
 * (`CognitoAuthService`), a test injects a double of it, and neither side can
 * tell which it got — the same dependency inversion the backend uses for
 * `MalwareScanner` and `EventPublisher`.
 *
 * There is no factory and no environment branch here. Choosing the
 * implementation happens in exactly one place, `src/App.tsx`; configuration
 * differs between environments, code does not.
 */

/**
 * What a signed-in user is, as far as the rest of the app is concerned.
 *
 * The ID token and nothing else: the SPA sends the *ID* token as its bearer
 * credential (the backend verifier checks `aud` and rejects an access token
 * outright), and a refresh or access token held here is a credential that ends
 * up rendered or logged by accident. The library keeps the rest.
 */
export interface AuthSession {
  readonly idToken: string;
  readonly email: string;
}

export interface CredentialsInput {
  email: string;
  password: string;
}

export interface ConfirmSignUpInput {
  email: string;
  code: string;
}

export interface ConfirmForgotPasswordInput {
  email: string;
  code: string;
  newPassword: string;
}

/**
 * Every operation the auth pages need, and nothing they do not.
 *
 * Adding a member here is a contract change: `src/test/auth.tsx`'s double
 * declares `implements AuthService`, so an unimplemented operation fails
 * `npm run typecheck` rather than surfacing as a missing function at runtime.
 */
export interface AuthService {
  /** Create the Cognito identity. `userConfirmed` is false when an email code is pending. */
  signUp(input: CredentialsInput): Promise<{ userConfirmed: boolean }>;
  /** Spend the emailed confirmation code. */
  confirmSignUp(input: ConfirmSignUpInput): Promise<void>;
  /** Send a fresh confirmation code; Cognito's expires, and without this the only recovery is a second account. */
  resendConfirmationCode(email: string): Promise<void>;
  signIn(input: CredentialsInput): Promise<AuthSession>;
  /** Synchronous: dropping the local tokens is local work, and nothing should await it. */
  signOut(): void;
  /** Start a password reset — Cognito emails the code. */
  forgotPassword(email: string): Promise<void>;
  /** Finish a password reset with the code that was emailed. */
  confirmForgotPassword(input: ConfirmForgotPasswordInput): Promise<void>;
  /** The stored session, refreshed if it needs it, or `null` when there is none. */
  refreshSession(): Promise<AuthSession | null>;
  /** The current ID token, or `null` for an anonymous request. */
  getIdToken(): Promise<string | null>;
}

/**
 * A failure from the identity provider, translated at the seam.
 *
 * `code` is the provider's own error name (`UsernameExistsException`,
 * `CodeMismatchException`, …), which is what lets a page put a failure on the
 * field it is about without importing the SDK to recognise it.
 */
export class AuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    // Named, so a stack trace and a logger both say what this is.
    this.name = "AuthError";
    this.code = code;
    // The classic transpiled `extends Error` bug: when the class is emitted for
    // an older target, `super()` returns a plain `Error` and the prototype chain
    // is lost, so `instanceof AuthError` is false by the time a page catches it
    // across an `await`. Restoring the prototype explicitly costs nothing and
    // survives whatever the build target becomes.
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}
