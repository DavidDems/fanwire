import createClient, { type Client, type Middleware } from "openapi-fetch";

import { config } from "../config";
import type { paths } from "./schema";

/**
 * The typed HTTP client. `paths` is generated from `backend/openapi.json`
 * (`npm run gen:api-types`) — nothing here hand-writes an API shape.
 *
 * Auth is one middleware over an *injected* token provider. The client does not
 * import the auth layer and does not know Cognito exists: FRONTEND-002 injects
 * the real provider with `setTokenProvider`, tests inject a double. That seam is
 * the reason there is no environment branch anywhere in this file.
 */
export type ApiClient = Client<paths>;

/**
 * Returns the ID token to send, or `null` for an anonymous request.
 *
 * Asynchronous by design: Cognito's session lookup is, and the seam has to take
 * an async provider without a second code path.
 */
export type TokenProvider = () => string | null | Promise<string | null>;

/** The default until something injects otherwise: the guest feed renders before anyone signs in. */
const anonymous: TokenProvider = () => null;

let currentTokenProvider: TokenProvider = anonymous;

/** Install the provider every subsequent `apiClient` request reads its token from. */
export function setTokenProvider(provider: TokenProvider): void {
  currentTokenProvider = provider;
}

/**
 * `VITE_API_BASE_URL` is `/api` — relative and same-origin by design (Vite's
 * proxy strips the prefix in dev, a CloudFront Function does it in production).
 * `Request` will not accept a relative URL outside a browser document, so the
 * configured base is resolved against the current origin. Still one origin,
 * still no CORS; an absolute base would pass through unchanged.
 */
function resolveBaseUrl(base: string): string {
  return new URL(base, window.location.origin).toString();
}

function authorization(provider: TokenProvider): Middleware {
  return {
    async onRequest({ request }) {
      const token = await provider();
      // No token means *no header*, not an empty one: `Authorization: Bearer null`
      // and `Authorization: ` both make the backend verifier reject what was meant
      // to be an anonymous request.
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return request;
    },
  };
}

/** Build an independent client around one provider — the seam a test double comes in through. */
export function createApiClient(provider: TokenProvider): ApiClient {
  const client = createClient<paths>({ baseUrl: resolveBaseUrl(config.apiBaseUrl) });
  client.use(authorization(provider));
  return client;
}

/**
 * The client the application uses. Its provider is read through a closure on
 * every request, so a later `setTokenProvider` takes effect on requests already
 * issued from modules that imported this singleton at load time.
 */
export const apiClient: ApiClient = createApiClient(() => currentTokenProvider());
