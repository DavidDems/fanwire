/**
 * FRONTEND-001 acceptance criteria 3 and 4 — `src/config.ts`.
 *
 * Vite inlines `VITE_*` at build time, so a bundle is only ever correct for the
 * environment it was built against. A missing variable therefore has to break
 * the build, loudly and by name; the alternative is a bundle that ships
 * `undefined` into a Cognito call and fails in a user's browser, days later,
 * with no signal anywhere near the deploy.
 *
 * Hence "throws at module load", not "returns a default" and not "throws when
 * you first read the property": the failure has to happen while something is
 * still watching.
 *
 * `vitest.config` sets `globals: false`, so every helper is imported.
 *
 * Vite *does* load `.env.local` in test mode — the opposite of what this
 * comment claimed until the harness was fixed, and the belief that let a test
 * pass locally and fail in a container with no env file. What makes the values
 * below the only ones these tests see is that every case stubs all five
 * explicitly, over the top of `vite.config.ts`'s `test.env`, which in turn
 * outranks `.env.local`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Deliberately distinct values: a swapped field/variable mapping must fail. */
const REQUIRED_ENV = {
  VITE_API_BASE_URL: "/api",
  VITE_COGNITO_REGION: "eu-west-2",
  VITE_COGNITO_USER_POOL_ID: "eu-west-2_TESTPOOL",
  VITE_COGNITO_CLIENT_ID: "test-spa-client-id",
  VITE_MEDIA_BASE_URL: "https://media.test.invalid",
} as const;

type EnvName = keyof typeof REQUIRED_ENV;

const ENV_NAMES = Object.keys(REQUIRED_ENV) as EnvName[];

function stubEnv(overrides: Partial<Record<EnvName, string | undefined>> = {}): void {
  for (const name of ENV_NAMES) {
    vi.stubEnv(name, name in overrides ? overrides[name] : REQUIRED_ENV[name]);
  }
}

/** A fresh evaluation of config.ts every time, so "at module load" means it. */
async function loadConfig(): Promise<typeof import("./config")> {
  return import("./config");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("config", () => {
  it("exposes every value as a non-empty string, read from its own variable", async () => {
    stubEnv();

    const { config } = await loadConfig();

    expect(config.apiBaseUrl).toBe(REQUIRED_ENV.VITE_API_BASE_URL);
    expect(config.cognitoRegion).toBe(REQUIRED_ENV.VITE_COGNITO_REGION);
    expect(config.cognitoUserPoolId).toBe(REQUIRED_ENV.VITE_COGNITO_USER_POOL_ID);
    expect(config.cognitoClientId).toBe(REQUIRED_ENV.VITE_COGNITO_CLIENT_ID);
    expect(config.mediaBaseUrl).toBe(REQUIRED_ENV.VITE_MEDIA_BASE_URL);

    for (const [field, value] of Object.entries(config)) {
      expect(typeof value, `${field} must be a string`).toBe("string");
      expect(String(value).length, `${field} must not be empty`).toBeGreaterThan(0);
    }
  });

  it.each(ENV_NAMES)("throws at module load naming %s when it is absent", async (name) => {
    stubEnv({ [name]: undefined });

    await expect(loadConfig()).rejects.toThrow(new RegExp(name));
  });

  it.each(ENV_NAMES)("throws at module load naming %s when it is empty", async (name) => {
    stubEnv({ [name]: "" });

    await expect(loadConfig()).rejects.toThrow(new RegExp(name));
  });

  // Stronger than the criterion's singular "the missing variable", on purpose:
  // reporting all of them at once costs one build cycle instead of five.
  it("names every missing variable, not only the first one it hits", async () => {
    stubEnv({ VITE_COGNITO_CLIENT_ID: undefined, VITE_MEDIA_BASE_URL: "" });

    await expect(loadConfig()).rejects.toThrow(/VITE_COGNITO_CLIENT_ID/);
    vi.resetModules();
    await expect(loadConfig()).rejects.toThrow(/VITE_MEDIA_BASE_URL/);
  });
});
