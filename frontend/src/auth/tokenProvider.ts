import { setTokenProvider } from "../api/client";
import type { AuthService } from "./AuthService";

/**
 * Fill in the seam `FRONTEND-001` left: from here on, every `apiClient` request
 * carries the *current* ID token, and carries no `Authorization` header at all
 * when there is no session.
 *
 * Installed once, from `App`, with the same service the pages use.
 */
export function installTokenProvider(authService: AuthService): void {
  // The service is asked on every request rather than once at install time.
  // Cognito rotates the ID token, and signing out has to take effect on the next
  // request — not on the next page load.
  setTokenProvider(() => authService.getIdToken());
}
