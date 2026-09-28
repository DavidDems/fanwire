import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { AuthService, AuthSession, CredentialsInput } from "./AuthService";

/**
 * The session state every page and guard reads.
 *
 * The service arrives as a prop rather than being constructed here: that is the
 * whole dependency inversion. `App` injects the Cognito implementation, a test
 * injects a double, and nothing downstream learns which it got.
 *
 * The provider deliberately uses no router hooks. `App` mounts it *outside*
 * `RouterProvider` — a session does not belong to a route — so needing router
 * context would make the app impossible to wire the way it is wired.
 */

/**
 * Three states, not two.
 *
 * "Not signed in" and "we do not know yet" are different things, and collapsing
 * them is exactly what makes a guard flash the sign-in page at a signed-in user
 * on every reload.
 */
export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthContextValue {
  status: AuthStatus;
  session: AuthSession | null;
  /**
   * The injected service itself. Sign-up, confirmation and password reset are
   * operations the context holds no state for; pages reach them through this,
   * so they still depend on the interface rather than importing the one
   * implementation.
   */
  authService: AuthService;
  /** Sign in *and* update the session the guards read, in one call. */
  signIn: (input: CredentialsInput) => Promise<AuthSession>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  authService: AuthService;
  children: ReactNode;
}

export function AuthProvider({ authService, children }: AuthProviderProps) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    // Restore once, on mount, from the service. The service answers this from
    // its own token store; the provider itself makes no HTTP request, so a cold
    // start renders the guest feed without asking the API anything.
    let listening = true;
    setStatus("loading");

    authService.refreshSession().then(
      (restored) => {
        if (!listening) return;
        setSession(restored);
        setStatus(restored ? "authenticated" : "anonymous");
      },
      () => {
        // A restore that failed is the same state as no session: anonymous. It
        // is not reported — the reason lives in the provider's own failure, and
        // printing it here is how a token reaches a console.
        if (!listening) return;
        setSession(null);
        setStatus("anonymous");
      },
    );

    return () => {
      listening = false;
    };
  }, [authService]);

  const signIn = useCallback(
    async (input: CredentialsInput): Promise<AuthSession> => {
      const next = await authService.signIn(input);
      setSession(next);
      setStatus("authenticated");
      return next;
    },
    [authService],
  );

  const signOut = useCallback((): void => {
    authService.signOut();
    setSession(null);
    setStatus("anonymous");
  }, [authService]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, authService, signIn, signOut }),
    [status, session, authService, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Fail fast at the boundary: a component rendered outside the provider is a
 * wiring mistake, and a silently-anonymous context would turn it into a
 * logged-out user nobody can explain.
 */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be called inside an <AuthProvider>.");
  }
  return value;
}
