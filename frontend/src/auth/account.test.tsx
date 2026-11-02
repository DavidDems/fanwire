/**
 * FRONTEND-012 criterion 13 — one hook decides the account state for the whole
 * app.
 *
 * `useAccount()` (`auth/account.ts`) reads `useAuth()` and the one profile
 * query (`auth/profile.ts`) and answers one of four states:
 *
 * | session                          | `GET /users/me`          | `status`        |
 * |----------------------------------|--------------------------|-----------------|
 * | not yet restored                 | —                        | `"loading"`     |
 * | none                             | never asked              | `"anonymous"`   |
 * | restored                         | in flight                | `"loading"`     |
 * | restored                         | 200 `MeOut`              | `"active"`, with `profile` |
 * | restored                         | 403 `account_deactivated`| `"deactivated"` |
 *
 * A session with no profile row yet (404) is none of `active` and
 * `deactivated`; what it is beyond that is the guards' business, which they
 * already route to profile creation.
 *
 * **Nobody re-derives it.** The card's controls, the stats pages' "Post about
 * this" links and the guards all read this hook, and the deactivated marker
 * (`ACCOUNT_DEACTIVATED`) is named nowhere outside `auth/profile.ts` and
 * `auth/account.ts`: a component that compared the profile query's data with
 * it would be a second place deciding the state. Pinned from disk, the way
 * `feed-isolation.test.ts` pins its rules.
 *
 * The interface pinned: `useAccount()` returns `{ status }`, plus `profile`
 * (the `MeOut`) when `status` is `"active"` — the id a card compares
 * `post.author.id` with.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { FEED_PAGES_KEY } from "../features/feed/api";
import {
  NOTIFICATIONS_QUERY_KEY,
  PREFERENCE_QUERY_KEY,
} from "../features/notifications/api";
import { SRC_DIR } from "../test/css";
import {
  FakeAuthService,
  profileDeactivated,
  profileFound,
  profileMissing,
  testProfile,
  testSession,
} from "../test/auth";
import { createTestQueryClient } from "../test/render";
import { server } from "../test/server";
import { useAccount, useSignOut } from "./account";
import { AuthProvider, useAuth } from "./AuthContext";
import { PROFILE_QUERY_KEY } from "./profile";

function renderAccount(authService = new FakeAuthService()) {
  const client = createTestQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <AuthProvider authService={authService}>{children}</AuthProvider>
      </QueryClientProvider>
    );
  }
  return renderHook(() => ({ account: useAccount(), auth: useAuth() }), {
    wrapper: Wrapper,
  });
}

function signedIn(): FakeAuthService {
  return new FakeAuthService({ session: testSession() });
}

describe("useAccount", () => {
  it("is loading while the session is being restored", async () => {
    server.use(profileFound());
    const service = signedIn();
    const resume = service.pause();

    const { result } = renderAccount(service);

    expect(result.current.account.status).toBe("loading");

    resume();
    await waitFor(() => expect(result.current.account.status).toBe("active"));
  });

  it("is anonymous with no session, and never asks GET /users/me", async () => {
    const asked: string[] = [];
    server.use(
      http.get("*/users/me", ({ request }) => {
        asked.push(request.url);
        return HttpResponse.json({ detail: "Not Found" }, { status: 404 });
      }),
    );

    const { result } = renderAccount();

    await waitFor(() =>
      expect(result.current.account.status).toBe("anonymous"),
    );
    expect(asked).toEqual([]);
  });

  it("is loading while the profile is in flight", async () => {
    let release = () => {};
    const answered = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("*/users/me", async () => {
        await answered;
        return HttpResponse.json(testProfile());
      }),
    );

    const { result } = renderAccount(signedIn());

    await waitFor(() =>
      expect(result.current.auth.status).toBe("authenticated"),
    );
    expect(result.current.account.status).toBe("loading");

    release();
    await waitFor(() => expect(result.current.account.status).toBe("active"));
  });

  it("is active, with the caller's profile, on a 200", async () => {
    server.use(profileFound(testProfile({ id: 7 })));

    const { result } = renderAccount(signedIn());

    await waitFor(() => expect(result.current.account.status).toBe("active"));
    const account = result.current.account;
    const profile = account.status === "active" ? account.profile : null;
    expect(profile?.id).toBe(7);
  });

  it("is deactivated on a 403 account_deactivated", async () => {
    server.use(profileDeactivated());

    const { result } = renderAccount(signedIn());

    await waitFor(() =>
      expect(result.current.account.status).toBe("deactivated"),
    );
  });

  it("is neither active nor deactivated for a session with no profile yet", async () => {
    server.use(profileMissing());

    const { result } = renderAccount(signedIn());

    await waitFor(() =>
      expect(result.current.auth.status).toBe("authenticated"),
    );
    // Settled: give the 404 time to land before reading the state.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(["active", "deactivated"]).not.toContain(
      result.current.account.status,
    );
  });

  it("goes back to anonymous on sign-out, from deactivated", async () => {
    server.use(profileDeactivated());

    const { result } = renderAccount(signedIn());
    await waitFor(() =>
      expect(result.current.account.status).toBe("deactivated"),
    );

    act(() => {
      result.current.auth.signOut();
    });

    await waitFor(() =>
      expect(result.current.account.status).toBe("anonymous"),
    );
  });
});

/*
 * FRONTEND-027: useSignOut, now that an active member with a full cache can
 * press it. No feed key carries a viewer, so what is cached would be shown to
 * whoever comes next on this tab.
 */
describe("useSignOut", () => {
  const CACHED: [string, readonly unknown[]][] = [
    ["the notifications list", NOTIFICATIONS_QUERY_KEY],
    ["the notification preference", PREFERENCE_QUERY_KEY],
    ["the feed pages", FEED_PAGES_KEY],
    ["the profile", PROFILE_QUERY_KEY],
  ];

  function renderSignOut() {
    server.use(profileFound());
    const client = createTestQueryClient();
    const service = signedIn();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <AuthProvider authService={service}>{children}</AuthProvider>
        </QueryClientProvider>
      );
    }
    const hook = renderHook(() => useSignOut(), { wrapper: Wrapper });
    return { hook, client, service };
  }

  it("signs out once", () => {
    const { hook, service } = renderSignOut();

    act(() => {
      hook.result.current();
    });

    expect(service.callsTo("signOut")).toHaveLength(1);
  });

  it.each(CACHED)("leaves no data for %s", (_name, key) => {
    const { hook, client } = renderSignOut();
    client.setQueryData(key, { from: "the previous account" });

    act(() => {
      hook.result.current();
    });

    expect(client.getQueryData(key)).toBeUndefined();
  });

  it("leaves no data under a key nobody thought of", () => {
    const { hook, client } = renderSignOut();
    client.setQueryData(["a", "later", "feature"], "the previous account's");

    act(() => {
      hook.result.current();
    });

    expect(client.getQueryData(["a", "later", "feature"])).toBeUndefined();
  });
});

/*
 * The structural half: who reads the hook, and that nobody else decides.
 */

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

function posix(file: string): string {
  return relative(SRC_DIR, file).split(sep).join("/");
}

function isTest(file: string): boolean {
  return /\.test\.tsx?$/.test(file) || posix(file).startsWith("test/");
}

/** Line and block comments out, so a sentence about the hook is not a use of it. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const APP_FILES = sourceFiles(SRC_DIR).filter((file) => !isTest(file));

function readsTheHook(file: string): boolean {
  const source = code(file);
  return (
    /\buseAccount\s*\(/.test(source) &&
    /from\s+["'][./]*auth\/account["']|from\s+["']\.\/account["']/.test(source)
  );
}

describe("one hook, read by everyone who needs the account state", () => {
  it("walks real files (not vacuously green)", () => {
    expect(APP_FILES.length).toBeGreaterThan(20);
    expect(APP_FILES.map(posix)).toContain("auth/profile.ts");
  });

  it.each([["the route guards", "routes/guards.tsx"]])(
    "%s read useAccount (%s)",
    (_name, path) => {
      expect(readsTheHook(join(SRC_DIR, path)), path).toBe(true);
    },
  );

  it.each([
    ["the post card's controls", "features/feed"],
    ["the game page's Post about this links", "features/games"],
    ["the player page's Post about this links", "features/players"],
  ])("%s read useAccount (somewhere under %s)", (_name, directory) => {
    const readers = sourceFiles(join(SRC_DIR, directory))
      .filter((file) => !isTest(file))
      .filter(readsTheHook)
      .map(posix);

    expect(
      readers.length,
      `no module under ${directory} reads useAccount`,
    ).toBeGreaterThan(0);
  });

  it("names the deactivated marker only in auth/profile.ts and auth/account.ts", () => {
    const naming = APP_FILES.filter((file) =>
      /\bACCOUNT_DEACTIVATED\b/.test(code(file)),
    ).map(posix);

    expect(naming, "profile.ts defines it").toContain("auth/profile.ts");
    expect(
      naming.filter(
        (path) => path !== "auth/profile.ts" && path !== "auth/account.ts",
      ),
    ).toEqual([]);
  });
});
