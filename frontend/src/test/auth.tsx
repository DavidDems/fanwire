import { HttpResponse, http, type RequestHandler } from "msw";
import type { RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import type { components } from "../api/schema";
import { AuthProvider } from "../auth/AuthContext";
import { AuthError } from "../auth/AuthService";
import type { AuthService, AuthSession } from "../auth/AuthService";
import { renderWithProviders, type RenderWithProvidersOptions } from "./render";

/**
 * The auth test kit: a double **of the `AuthService` interface**, and a render
 * helper that puts it in scope.
 *
 * This exists so that no test in this unit ever mocks the Cognito SDK. A test
 * that mocked it would pin the mock: it would keep passing after the real call
 * signature changed, which is the exact failure the interface was introduced to
 * prevent (FRONTEND-002 acceptance criterion 1). `auth/sdk-isolation.test.ts`
 * enforces that from disk, so the package name is deliberately not written here.
 *
 * Nothing here mocks HTTP either — the API is mocked at the network layer by
 * `msw`, and the three handler factories at the bottom are the profile/teams
 * responses six test files would otherwise each rewrite.
 */

export const TEST_ID_TOKEN = "fake-id-token-not-a-real-jwt";
export const TEST_EMAIL = "fan@example.test";
export const TEST_PASSWORD = "Correct-Horse-Battery-1";

export function testSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return { idToken: TEST_ID_TOKEN, email: TEST_EMAIL, ...overrides };
}

/** Every operation on the interface — the double records calls under these names. */
export type AuthMethod = keyof AuthService;

export interface FakeAuthServiceOptions {
  /** The session the double starts with. `null` (the default) is signed out. */
  session?: AuthSession | null;
  /** What `signUp` reports back; Cognito with email verification says `false`. */
  userConfirmed?: boolean;
}

interface RecordedCall {
  method: AuthMethod;
  input: unknown;
}

/**
 * A configurable double of `AuthService`.
 *
 * It is a class rather than a bag of `vi.fn()`s so that `implements AuthService`
 * is checked by `tsc`: if the interface grows a method, this fails to compile
 * instead of quietly letting a page call something no double provides.
 */
export class FakeAuthService implements AuthService {
  session: AuthSession | null;
  userConfirmed: boolean;

  /** Every call this double has seen, in order. */
  readonly calls: RecordedCall[] = [];

  private readonly failures = new Map<AuthMethod, AuthError>();
  private gate: Promise<void> | null = null;
  private openGate: (() => void) | null = null;

  constructor(options: FakeAuthServiceOptions = {}) {
    this.session = options.session ?? null;
    this.userConfirmed = options.userConfirmed ?? false;
  }

  /** Make `method` reject with a Cognito failure carrying `code`. */
  failWith(method: AuthMethod, code: string, message = `${code} (from the auth double)`): this {
    this.failures.set(method, new AuthError(code, message));
    return this;
  }

  /**
   * Hold every asynchronous call open until the returned function is called, so
   * a test can observe a pending state (a guard's loading status, a disabled
   * submit button) rather than racing it.
   */
  pause(): () => void {
    this.gate = new Promise<void>((resolve) => {
      this.openGate = resolve;
    });
    return () => {
      this.openGate?.();
      this.gate = null;
      this.openGate = null;
    };
  }

  /** The inputs `method` was called with, in order. */
  callsTo(method: AuthMethod): unknown[] {
    return this.calls.filter((call) => call.method === method).map((call) => call.input);
  }

  private async enter(method: AuthMethod, input: unknown): Promise<void> {
    // Recorded before the gate, so a paused call is still observable as "started".
    this.calls.push({ method, input });
    if (this.gate) await this.gate;
    const failure = this.failures.get(method);
    if (failure) throw failure;
  }

  async signUp(input: { email: string; password: string }): Promise<{ userConfirmed: boolean }> {
    await this.enter("signUp", input);
    return { userConfirmed: this.userConfirmed };
  }

  async confirmSignUp(input: { email: string; code: string }): Promise<void> {
    await this.enter("confirmSignUp", input);
  }

  async resendConfirmationCode(email: string): Promise<void> {
    await this.enter("resendConfirmationCode", email);
  }

  async signIn(input: { email: string; password: string }): Promise<AuthSession> {
    await this.enter("signIn", input);
    this.session = testSession({ email: input.email });
    return this.session;
  }

  signOut(): void {
    this.calls.push({ method: "signOut", input: undefined });
    this.session = null;
  }

  async forgotPassword(email: string): Promise<void> {
    await this.enter("forgotPassword", email);
  }

  async confirmForgotPassword(input: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<void> {
    await this.enter("confirmForgotPassword", input);
  }

  async refreshSession(): Promise<AuthSession | null> {
    await this.enter("refreshSession", undefined);
    return this.session;
  }

  async getIdToken(): Promise<string | null> {
    await this.enter("getIdToken", undefined);
    return this.session?.idToken ?? null;
  }
}

export interface RenderWithAuthOptions extends RenderWithProvidersOptions {
  /** The double every page and guard in the render reads its auth from. */
  authService?: AuthService;
}

export interface RenderWithAuthResult extends RenderResult {
  authService: AuthService;
}

/**
 * `renderWithProviders` plus an `AuthProvider` around the subject.
 *
 * The provider is layered *inside* the memory router the shared helper supplies,
 * which is deliberate: `AuthProvider` must not depend on router context, because
 * `App` mounts it outside `RouterProvider`. `src/routes/auth-flow.test.tsx`
 * mounts it the other way round, and both have to work.
 *
 * `rerender` from the returned result re-renders without the provider — use a
 * fresh render instead.
 */
export function renderWithAuth(
  ui: ReactElement,
  options: RenderWithAuthOptions = {},
): RenderWithAuthResult {
  const { authService = new FakeAuthService(), ...renderOptions } = options;
  const result = renderWithProviders(
    <AuthProvider authService={authService}>{ui}</AuthProvider>,
    renderOptions,
  );
  return { ...result, authService };
}

type MeOut = components["schemas"]["MeOut"];
type TeamOut = components["schemas"]["TeamOut"];

/** The caller's own profile, `date_of_birth` and all — `GET /users/me` returns `MeOut`. */
export function testProfile(overrides: Partial<MeOut> = {}): MeOut {
  return {
    id: 7,
    username: "raptorsfan",
    description: null,
    preferred_team_id: 1,
    profile_picture_media_id: null,
    created_at: "2026-09-01T00:00:00Z",
    follower_count: 0,
    following_count: 0,
    date_of_birth: "1994-04-05",
    ...overrides,
  };
}

export function testTeams(): TeamOut[] {
  return [
    {
      id: 1,
      api_sports_team_id: 141,
      name: "Toronto Raptors",
      abbreviation: "TOR",
      conference: "Eastern",
      division: "Atlantic",
      logo_url: null,
    },
    {
      id: 2,
      api_sports_team_id: 139,
      name: "Phoenix Suns",
      abbreviation: "PHX",
      conference: "Western",
      division: "Pacific",
      logo_url: null,
    },
  ];
}

/** `GET /users/me` → 200: an authenticated caller who already has a profile. */
export function profileFound(profile: MeOut = testProfile()): RequestHandler {
  return http.get("*/users/me", () => HttpResponse.json<MeOut>(profile));
}

/**
 * `GET /users/me` → 404: a valid token with no profile row yet.
 *
 * A routing state, not an error ([[0x08-frontend]]). The 404 is not in the
 * OpenAPI document — only the 200 is declared — so the body is FastAPI's own
 * shape rather than a generated type.
 */
export function profileMissing(): RequestHandler {
  return http.get("*/users/me", () => HttpResponse.json({ detail: "Not Found" }, { status: 404 }));
}

/** `GET /events/teams` → 200, the preferred-team choices. */
export function teamsAre(teams: TeamOut[] = testTeams()): RequestHandler {
  return http.get("*/events/teams", () => HttpResponse.json<TeamOut[]>(teams));
}
