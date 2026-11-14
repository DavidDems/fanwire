/**
 * FRONTEND-012 criterion 9 — `auth/profile.ts` reads `GET /users/me`'s 403
 * `{"detail": "account_deactivated"}` as a result of its own.
 *
 * `fetchProfile` had two answers and a failure: the caller's `MeOut` (200),
 * `null` for "a session, no profile row yet" (404), and a thrown error for
 * anything else — which every guard shows as "We could not check your
 * profile". `USERS-003` adds a third answer: the account exists and its owner
 * deactivated it. That is a state the app answers with recovery, so it is
 * neither the error (nothing failed) nor `null` (offering profile creation to
 * someone who has a profile is the defect `RequireNewProfile` exists to
 * prevent).
 *
 * The interface pinned: `ACCOUNT_DEACTIVATED`, exported beside
 * `PROFILE_QUERY_KEY`, is what `fetchProfile` resolves to, compared by
 * identity, and it is what the one profile query caches. Only that exact body
 * is the state: any other 403 still throws.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  profileDeactivated,
  profileForbidden,
  profileFound,
  profileMissing,
  testProfile,
} from "../test/auth";
import { createTestQueryClient } from "../test/render";
import { server } from "../test/server";
import {
  ACCOUNT_DEACTIVATED,
  PROFILE_QUERY_KEY,
  fetchProfile,
  useProfile,
} from "./profile";

describe("fetchProfile", () => {
  it("resolves to the caller's profile on a 200", async () => {
    server.use(profileFound());

    await expect(fetchProfile()).resolves.toEqual(testProfile());
  });

  it("resolves to null on a 404: a session with no profile row yet", async () => {
    server.use(profileMissing());

    await expect(fetchProfile()).resolves.toBeNull();
  });

  it("resolves to ACCOUNT_DEACTIVATED on a 403 account_deactivated", async () => {
    server.use(profileDeactivated());

    const result = await fetchProfile();

    expect(result).toBe(ACCOUNT_DEACTIVATED);
  });

  it("does not mistake the deactivated state for 'no profile'", async () => {
    server.use(profileDeactivated());

    const result = await fetchProfile();

    expect(result).not.toBeNull();
    expect(result).not.toEqual(
      expect.objectContaining({ id: expect.anything() }),
    );
  });

  it("still throws on any other 403", async () => {
    server.use(profileForbidden("Not authenticated"));

    await expect(fetchProfile()).rejects.toThrow();
  });

  it("still throws on a 403 with no body", async () => {
    server.use(
      http.get("*/users/me", () => new HttpResponse(null, { status: 403 })),
    );

    await expect(fetchProfile()).rejects.toThrow();
  });

  it("still throws on a 500", async () => {
    server.use(
      http.get("*/users/me", () =>
        HttpResponse.json({ detail: "Internal Server Error" }, { status: 500 }),
      ),
    );

    await expect(fetchProfile()).rejects.toThrow();
  });
});

describe("useProfile and the deactivated state", () => {
  function wrapperWith(client = createTestQueryClient()) {
    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client }, children);
    }
    return { client, Wrapper };
  }

  it("is a success, not an error, carrying ACCOUNT_DEACTIVATED", async () => {
    server.use(profileDeactivated());
    const { Wrapper } = wrapperWith();

    const { result } = renderHook(() => useProfile(true), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toBe(ACCOUNT_DEACTIVATED);
  });

  it("is cached under the one PROFILE_QUERY_KEY entry, read once", async () => {
    const reads: string[] = [];
    server.use(
      http.get("*/users/me", ({ request }) => {
        reads.push(request.url);
        return HttpResponse.json(
          { detail: "account_deactivated" },
          { status: 403 },
        );
      }),
    );
    const { client, Wrapper } = wrapperWith();

    const first = renderHook(() => useProfile(true), { wrapper: Wrapper });
    const second = renderHook(() => useProfile(true), { wrapper: Wrapper });

    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(client.getQueryData(PROFILE_QUERY_KEY)).toBe(ACCOUNT_DEACTIVATED);
    expect(reads).toHaveLength(1);
  });

  it("any other 403 is still the query's error", async () => {
    server.use(profileForbidden());
    const { Wrapper } = wrapperWith();

    const { result } = renderHook(() => useProfile(true), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
