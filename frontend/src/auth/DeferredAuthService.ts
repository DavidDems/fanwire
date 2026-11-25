import type {
  AuthService,
  AuthSession,
  ConfirmForgotPasswordInput,
  ConfirmSignUpInput,
  CredentialsInput,
} from "./AuthService";

/**
 * An `AuthService` that loads the real one on demand (`FRONTEND-051`).
 *
 * The Cognito SDK, its `buffer` polyfill and its `@aws-crypto` dependencies are
 * the largest thing in the entry chunk that the first paint does not need.
 * `App` hands this class a loader that imports `CognitoAuthService` dynamically,
 * so the SDK becomes a lazy chunk and the entry keeps room under ADR 0041's raw
 * cap. This file names no implementation: which one loads is still `App`'s
 * choice alone.
 *
 * - The load starts in the constructor, so session restore begins at module
 *   load as before and the chunk arrives in parallel with the first render.
 * - Every async method awaits the loaded service and delegates, arguments and
 *   result unchanged; a rejection (an `AuthError`) reaches the caller as the
 *   same object.
 * - `signOut()` stays synchronous: at once when the service is loaded,
 *   otherwise as soon as a load succeeds, before any call that waited on it.
 * - A failed load rejects the calls waiting on it and is not kept: the next
 *   call asks the loader again, so a chunk dropped on a flaky network does not
 *   leave the tab unable to sign in until a reload.
 */
export class DeferredAuthService implements AuthService {
  private readonly loader: () => Promise<AuthService>;
  private loaded: AuthService | null = null;
  private loading: Promise<AuthService> | null = null;
  private signOutWhenLoaded = false;

  constructor(loader: () => Promise<AuthService>) {
    this.loader = loader;
    // Nothing may be waiting on this first load; a failure is handled by the
    // next call retrying, not reported as an unhandled rejection here.
    this.service().catch(() => undefined);
  }

  private service(): Promise<AuthService> {
    if (this.loaded) return Promise.resolve(this.loaded);
    if (!this.loading) {
      this.loading = this.loader().then(
        (service) => {
          this.loaded = service;
          // Before any call that waited on this load, so a sign-in made after
          // the sign-out is not undone by it.
          if (this.signOutWhenLoaded) {
            this.signOutWhenLoaded = false;
            service.signOut();
          }
          return service;
        },
        (error: unknown) => {
          this.loading = null;
          throw error;
        },
      );
    }
    return this.loading;
  }

  async signUp(input: CredentialsInput): Promise<{ userConfirmed: boolean }> {
    return (await this.service()).signUp(input);
  }

  async confirmSignUp(input: ConfirmSignUpInput): Promise<void> {
    return (await this.service()).confirmSignUp(input);
  }

  async resendConfirmationCode(email: string): Promise<void> {
    return (await this.service()).resendConfirmationCode(email);
  }

  async signIn(input: CredentialsInput): Promise<AuthSession> {
    return (await this.service()).signIn(input);
  }

  signOut(): void {
    if (this.loaded) {
      this.loaded.signOut();
      return;
    }
    // Not loaded yet: sign out as soon as it is. If this load fails, the
    // request is kept for the load that succeeds, so stored tokens are still
    // dropped before anything can read them.
    this.signOutWhenLoaded = true;
    this.service().catch(() => undefined);
  }

  async forgotPassword(email: string): Promise<void> {
    return (await this.service()).forgotPassword(email);
  }

  async confirmForgotPassword(
    input: ConfirmForgotPasswordInput,
  ): Promise<void> {
    return (await this.service()).confirmForgotPassword(input);
  }

  async refreshSession(): Promise<AuthSession | null> {
    return (await this.service()).refreshSession();
  }

  async getIdToken(): Promise<string | null> {
    return (await this.service()).getIdToken();
  }

  async reauthenticate(password: string): Promise<void> {
    return (await this.service()).reauthenticate(password);
  }

  async emailVerified(): Promise<boolean> {
    return (await this.service()).emailVerified();
  }

  async requestEmailVerification(): Promise<void> {
    return (await this.service()).requestEmailVerification();
  }

  async confirmEmailVerification(code: string): Promise<void> {
    return (await this.service()).confirmEmailVerification(code);
  }
}
