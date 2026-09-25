/// <reference types="vite/client" />

/**
 * The one module that reads the Vite build-time environment.
 *
 * Vite inlines `VITE_*` at build time, so a bundle is only ever correct for the
 * environment it was built against — and the production Cognito pool id only
 * exists after `Fanwire-Auth` deploys. A missing variable therefore has to fail
 * while someone is still watching the deploy, by name, rather than ship
 * `undefined` into a Cognito call and fail in a user's browser days later.
 *
 * Hence: read once, validate once, throw at module load. No defaults, no
 * fallbacks, no per-environment branching. Every other module imports `config`
 * from here — `src/test/env-usage.test.ts` enforces that from disk.
 */

/** Configuration field -> the `VITE_` variable it is read from. */
const SOURCES = {
  apiBaseUrl: "VITE_API_BASE_URL",
  cognitoRegion: "VITE_COGNITO_REGION",
  cognitoUserPoolId: "VITE_COGNITO_USER_POOL_ID",
  cognitoClientId: "VITE_COGNITO_CLIENT_ID",
  mediaBaseUrl: "VITE_MEDIA_BASE_URL",
} as const;

export type Config = { readonly [Field in keyof typeof SOURCES]: string };

function read(): Config {
  const env = import.meta.env as Record<string, string | undefined>;
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const [field, variable] of Object.entries(SOURCES)) {
    const value = env[variable];
    // Absent and empty are the same failure: an empty string in a `.env` file
    // is a variable someone meant to fill in and did not.
    if (typeof value !== "string" || value.length === 0) {
      missing.push(variable);
      continue;
    }
    values[field] = value;
  }

  // Every missing variable, not just the first: one build cycle to fix five
  // rather than five.
  if (missing.length > 0) {
    throw new Error(
      `Missing required Vite environment variable${missing.length > 1 ? "s" : ""}: ` +
        `${missing.join(", ")}. Vite inlines these at build time, so the value has ` +
        `to be present in the shell or in frontend/.env.local before the build runs.`,
    );
  }

  return values as Config;
}

export const config: Config = read();
