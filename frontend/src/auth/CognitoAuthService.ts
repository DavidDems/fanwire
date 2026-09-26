import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";

import { config } from "../config";
import { AuthError } from "./AuthService";
import type {
  AuthService,
  AuthSession,
  ConfirmForgotPasswordInput,
  ConfirmSignUpInput,
  CredentialsInput,
} from "./AuthService";

/**
 * The one implementation of `AuthService`, and the one module in `src/` that
 * knows which identity provider the app runs on. `src/auth/sdk-isolation.test.ts`
 * enforces that from disk, so it is not a rule anybody has to remember.
 *
 * Everything the SDK exposes is callback-shaped; every method here is the
 * `Promise` wrapper around one of those callbacks, and every failure is
 * translated into an `AuthError` at the boundary. Nothing above this file ever
 * sees a provider type.
 *
 * Token storage is the SDK's default — `localStorage`, accepted for v1 with the
 * XSS trade-off recorded in `wiki/CodeContext/Modules/0x08-frontend.md`. That
 * default is also why a cold start is free: with nothing stored,
 * `getCurrentUser()` answers `null` without a network call, which is what lets
 * the guest feed render before anyone signs in.
 */

/**
 * The provider's failures carry their error name on `code` (and, for anything
 * thrown rather than returned, on `name`). That name is the whole reason this
 * translation exists: a page branches on it to decide which field a failure
 * belongs on, without importing anything from here to do it.
 */
function toAuthError(cause: unknown): AuthError {
  if (cause instanceof AuthError) return cause;

  const failure = cause as { code?: unknown; name?: unknown; message?: unknown } | null;
  const code =
    typeof failure?.code === "string"
      ? failure.code
      : typeof failure?.name === "string"
        ? failure.name
        : "UnknownError";
  const message =
    typeof failure?.message === "string" && failure.message.length > 0
      ? failure.message
      : "Authentication failed.";

  return new AuthError(code, message);
}

/**
 * The ID token and the address it was issued for — never the access or refresh
 * token, which stay inside the library. `email` is read from the token's own
 * claims, falling back to the address the caller signed in with for the (rare)
 * pool whose ID token omits it.
 */
function sessionFrom(session: CognitoUserSession, fallbackEmail?: string): AuthSession {
  const idToken = session.getIdToken();
  const claimed: unknown = idToken.payload.email;

  return {
    idToken: idToken.getJwtToken(),
    email: typeof claimed === "string" ? claimed : (fallbackEmail ?? ""),
  };
}

export class CognitoAuthService implements AuthService {
  private readonly pool: CognitoUserPool;

  /**
   * No arguments, by design. `config` is the one reader of the build-time
   * environment and therefore the one source of the pool and client ids; a
   * constructor that accepted them would give every call site a chance to pass
   * something else, and give a test a reason to pass a real pool.
   */
  constructor() {
    this.pool = new CognitoUserPool({
      UserPoolId: config.cognitoUserPoolId,
      ClientId: config.cognitoClientId,
    });
  }

  signUp({ email, password }: CredentialsInput): Promise<{ userConfirmed: boolean }> {
    // The pool uses the email address as the username; the attribute is what
    // Cognito sends the confirmation code to.
    const attributes = [new CognitoUserAttribute({ Name: "email", Value: email })];

    return new Promise((resolve, reject) => {
      this.pool.signUp(email, password, attributes, [], (error, result) => {
        if (error || !result) {
          reject(toAuthError(error));
          return;
        }
        resolve({ userConfirmed: result.userConfirmed });
      });
    });
  }

  confirmSignUp({ email, code }: ConfirmSignUpInput): Promise<void> {
    return new Promise((resolve, reject) => {
      // `forceAliasCreation: true` — if the address was already an alias of
      // another account, let Cognito move it rather than fail the confirmation
      // of the account the user is sitting in front of.
      this.userFor(email).confirmRegistration(code, true, (error: unknown) => {
        if (error) {
          reject(toAuthError(error));
          return;
        }
        resolve();
      });
    });
  }

  resendConfirmationCode(email: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.userFor(email).resendConfirmationCode((error) => {
        if (error) {
          reject(toAuthError(error));
          return;
        }
        resolve();
      });
    });
  }

  signIn({ email, password }: CredentialsInput): Promise<AuthSession> {
    const user = this.userFor(email);
    const credentials = new AuthenticationDetails({ Username: email, Password: password });

    return new Promise((resolve, reject) => {
      user.authenticateUser(credentials, {
        onSuccess: (session) => {
          resolve(sessionFrom(session, email));
        },
        onFailure: (error: unknown) => {
          reject(toAuthError(error));
        },
        // Neither challenge has a screen yet. They are answered explicitly
        // because the SDK calls these hooks without checking they exist: left
        // out, a pool configured for either one fails with a `TypeError` from
        // inside the library instead of something a page can report.
        newPasswordRequired: () => {
          reject(
            new AuthError(
              "NewPasswordRequiredException",
              "This account has to set a new password before it can sign in.",
            ),
          );
        },
        mfaRequired: () => {
          reject(
            new AuthError(
              "MfaRequiredException",
              "This account needs a multi-factor code, which this app cannot collect yet.",
            ),
          );
        },
      });
    });
  }

  signOut(): void {
    // No session is not a failure: signing out of nothing is what a "sign out"
    // control does after the tokens have already expired or been cleared.
    this.pool.getCurrentUser()?.signOut();
  }

  forgotPassword(email: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.userFor(email).forgotPassword({
        onSuccess: () => {
          resolve();
        },
        onFailure: (error: unknown) => {
          reject(toAuthError(error));
        },
      });
    });
  }

  confirmForgotPassword({ email, code, newPassword }: ConfirmForgotPasswordInput): Promise<void> {
    return new Promise((resolve, reject) => {
      this.userFor(email).confirmPassword(code, newPassword, {
        onSuccess: () => {
          resolve();
        },
        onFailure: (error: unknown) => {
          reject(toAuthError(error));
        },
      });
    });
  }

  async refreshSession(): Promise<AuthSession | null> {
    const user = this.pool.getCurrentUser();
    // Nothing stored: signed out, answered locally. `App` mounts the provider
    // above the router and the provider asks this on mount, so a cold start
    // that reached the network here would delay — and, offline, break — the
    // guest feed for everyone who has never signed in.
    if (!user) return null;

    return new Promise((resolve) => {
      user.getSession((error: Error | null, session: CognitoUserSession | null) => {
        // A session that cannot be restored or refreshed is the same state as
        // no session at all: anonymous. The pages that need one will say so.
        if (error || !session || !session.isValid()) {
          resolve(null);
          return;
        }
        resolve(sessionFrom(session));
      });
    });
  }

  async getIdToken(): Promise<string | null> {
    // Deliberately the same path as `refreshSession`: `apiClient` reads this on
    // every request, and a token that is about to expire has to be refreshed
    // before it is sent, not after the backend rejects it.
    const session = await this.refreshSession();
    return session?.idToken ?? null;
  }

  private userFor(email: string): CognitoUser {
    return new CognitoUser({ Username: email, Pool: this.pool });
  }
}
