/**
 * FRONTEND-033 — what a profile shows while it is not ready yet.
 *
 * Measured before the change (PR): a cold navigation from the feed to
 * `/profile/:userId` left the feed on screen for ~500 ms with no feedback, then
 * showed a bare "Loading this profile…" line while the profile and the follow
 * set loaded. This file pins the second half — the data wait — against the real
 * `ProfilePage` under a real data router (navigations run in a transition, as
 * in the app). The chunk wait, behind the route's own Suspense, is
 * `profile-route-loading.test.tsx`'s.
 *
 * The loading state is the existing pattern (`components.md`: `StatusLine` +
 * `Skeleton`, as `HistoryPage` and `FeedPage` do it): the `role="status"` line
 * "Loading this profile…" is what is announced, and `aria-hidden` shared
 * `Skeleton` blocks hold the header card's place. Nothing takes focus.
 *
 * Every response here is held by a gate the test opens, so "while it is
 * loading" is a state the test is in, not a race it hopes to win.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http, type RequestHandler } from "msw";
import {
  Link,
  RouterProvider,
  createMemoryRouter,
  type RouteObject,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import { AuthProvider } from "../../auth/AuthContext";
import skeletonStyles from "../../components/ui/Skeleton.module.css";
import {
  FakeAuthService,
  teamsAre,
  testProfile,
  testSession,
} from "../../test/auth";
import { createTestQueryClient } from "../../test/render";
import { server } from "../../test/server";
import { followingStub, publicProfile, usernameForId } from "../../test/users";
import { ProfilePage } from "./ProfilePage";

type MeOut = components["schemas"]["MeOut"];
type PublicUserOut = components["schemas"]["PublicUserOut"];

/** The one announced loading line. The implementation must render exactly this text. */
const LOADING_TEXT = "Loading this profile…";
/** The existing failure line (`ProfilePage`), unchanged by this unit. */
const ERROR_TEXT = "We could not load this profile just now. Please try again.";

const FEED_STUB_HEADING = "Feed stub";
const PUBLIC_PROFILE_PATH = /\/users\/(\d+)$/;

/** A gate: a promise the handler waits on, and the function that opens it. */
interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function gate(): Gate {
  let open = (): void => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Every gate a test closed, opened again after it so no handler is left waiting. */
const openGates: Gate[] = [];

function closedGate(): Gate {
  const created = gate();
  openGates.push(created);
  return created;
}

interface ProfileReads {
  handler: RequestHandler;
  readonly requests: number[];
  /** Hold every read of `userId` until the returned function is called. */
  hold(userId: number): () => void;
  /** Answer reads of `userId` with a 500 until `recover` is called. */
  fail(userId: number): void;
  recover(userId: number): void;
}

/** `GET /users/{id}` → that id's profile, each id holdable and failable on its own. */
function profileReads(): ProfileReads {
  const requests: number[] = [];
  const held = new Map<number, Gate>();
  const failing = new Set<number>();

  return {
    handler: http.get(PUBLIC_PROFILE_PATH, async ({ request }) => {
      const matched = PUBLIC_PROFILE_PATH.exec(new URL(request.url).pathname);
      const id = Number(matched?.[1]);
      requests.push(id);
      const waiting = held.get(id);
      if (waiting !== undefined) await waiting.promise;
      if (failing.has(id)) {
        return HttpResponse.json(
          { detail: "Internal Server Error" },
          { status: 500 },
        );
      }
      return HttpResponse.json<PublicUserOut>(
        publicProfile({ id, username: usernameForId(id) }),
      );
    }),
    requests,
    hold(userId: number): () => void {
      const waiting = closedGate();
      held.set(userId, waiting);
      return () => {
        held.delete(userId);
        waiting.open();
      };
    },
    fail(userId: number): void {
      failing.add(userId);
    },
    recover(userId: number): void {
      failing.delete(userId);
    },
  };
}

/** `GET /users/me` → the caller's own profile, held until the returned function runs. */
function heldMe(profile: MeOut = testProfile()): {
  handler: RequestHandler;
  release: () => void;
} {
  const waiting = closedGate();
  return {
    handler: http.get("*/users/me", async () => {
      await waiting.promise;
      return HttpResponse.json<MeOut>(profile);
    }),
    release: waiting.open,
  };
}

/** A page to navigate *from*, with a real link to the profile. */
function FeedStub({ to }: { to: string }) {
  return (
    <section>
      <h1>{FEED_STUB_HEADING}</h1>
      <Link to={to}>Open profile</Link>
    </section>
  );
}

function renderRouter(
  initialPath: string,
  options: { signedIn?: boolean; linkTo?: string } = {},
) {
  const { signedIn = false, linkTo = "/profile/42" } = options;
  const routes: RouteObject[] = [
    { path: "/", element: <FeedStub to={linkTo} /> },
    { path: "/profile/:userId", element: <ProfilePage /> },
  ];
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const authService = new FakeAuthService(
    signedIn ? { session: testSession() } : {},
  );
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider authService={authService}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

/** Every rendered element carrying one of the shared `Skeleton`'s classes. */
function skeletonBlocks(): Element[] {
  const classes = new Set(
    Object.values(skeletonStyles as Record<string, string>),
  );
  return Array.from(document.body.querySelectorAll("*")).filter((element) =>
    Array.from(element.classList).some((name) => classes.has(name)),
  );
}

/**
 * The profile loading state, as a reader and a screen reader meet it: the one
 * `role="status"` line, and the shared Skeleton standing in for the header
 * card — hidden from assistive technology, so the line is the only thing
 * announced. No heading yet: nobody's username is on screen.
 */
function expectProfileLoading() {
  const line = screen.getByText(LOADING_TEXT);
  expect(
    line.closest('[role="status"]'),
    "the loading line is a status",
  ).not.toBeNull();

  const blocks = skeletonBlocks();
  expect(
    blocks.length,
    "the header card's place is held by Skeleton blocks",
  ).toBeGreaterThan(0);
  for (const block of blocks) {
    expect(
      block.closest('[aria-hidden="true"]'),
      "a Skeleton is aria-hidden",
    ).not.toBeNull();
  }

  expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
}

function expectNoLoading() {
  expect(screen.queryByText(LOADING_TEXT)).toBeNull();
  expect(skeletonBlocks()).toEqual([]);
}

function profileHeading(userId: number) {
  return screen.findByRole("heading", {
    level: 1,
    name: new RegExp(`^${usernameForId(userId)}$`, "i"),
  });
}

beforeEach(() => {
  server.use(teamsAre());
});

// `globals: false`, so Testing Library never registers its own auto-cleanup.
afterEach(() => {
  for (const waiting of openGates.splice(0)) waiting.open();
  cleanup();
});

describe("a profile whose data is still on its way", () => {
  it("shows the profile loading state at once, in place of the page it was opened from", async () => {
    const user = userEvent.setup();
    const reads = profileReads();
    server.use(reads.handler);
    reads.hold(42);
    renderRouter("/");

    await user.click(await screen.findByRole("link", { name: "Open profile" }));

    expect(
      screen.queryByRole("heading", { name: FEED_STUB_HEADING }),
    ).toBeNull();
    expectProfileLoading();
  });

  it("does not move focus to the loading state", async () => {
    const user = userEvent.setup();
    const reads = profileReads();
    server.use(reads.handler);
    reads.hold(42);
    renderRouter("/");

    await user.click(await screen.findByRole("link", { name: "Open profile" }));
    await waitFor(() => {
      expect(reads.requests).toContain(42);
    });

    expectProfileLoading();
    // The link that had focus has gone with its page; nothing took it.
    expect(document.activeElement).toBe(document.body);
  });

  it("replaces the loading state with the public profile when it arrives", async () => {
    const reads = profileReads();
    server.use(reads.handler);
    const release = reads.hold(42);
    renderRouter("/profile/42");

    await waitFor(() => {
      expect(reads.requests).toContain(42);
    });
    expectProfileLoading();

    release();

    expect(await profileHeading(42)).toBeInTheDocument();
    expect(screen.getByText("3 followers")).toBeInTheDocument();
    expectNoLoading();
  });

  it("replaces the loading state with the own profile when the caller's profile arrives", async () => {
    const me = heldMe();
    server.use(me.handler, followingStub().handler, profileReads().handler);
    renderRouter("/profile/7", { signedIn: true });

    await screen.findByText(LOADING_TEXT);
    expectProfileLoading();

    me.release();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: new RegExp(`^${testProfile().username}$`, "i"),
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/date of birth/i).length).toBeGreaterThan(0);
    expectNoLoading();
  });
});

describe("a profile that fails to load", () => {
  it("replaces the loading state with the error and a retry, and a retry loads the profile", async () => {
    const user = userEvent.setup();
    const reads = profileReads();
    server.use(reads.handler);
    reads.fail(42);
    const release = reads.hold(42);
    renderRouter("/profile/42");

    await waitFor(() => {
      expect(reads.requests).toContain(42);
    });
    expectProfileLoading();

    release();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ERROR_TEXT);
    expectNoLoading();
    const retry = screen.getByRole("button", { name: /^(retry|try again)$/i });

    reads.recover(42);
    await user.click(retry);

    expect(await profileHeading(42)).toBeInTheDocument();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expectNoLoading();
    expect(reads.requests.filter((id) => id === 42).length).toBeGreaterThan(1);
  });
});

describe("moving between two profiles", () => {
  it("never shows the previous profile while the next one loads, and back/forward show the requested one", async () => {
    const reads = profileReads();
    server.use(reads.handler);
    const router = renderRouter("/profile/1");
    expect(await profileHeading(1)).toBeInTheDocument();

    // Watch the whole wait for user 1's name, not only the moments sampled.
    const release = reads.hold(2);
    let staleSeen = false;
    const observer = new MutationObserver(() => {
      if ((document.body.textContent ?? "").includes(usernameForId(1))) {
        staleSeen = true;
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    await act(async () => {
      await router.navigate("/profile/2");
    });
    expect(screen.queryByText(usernameForId(1))).toBeNull();
    await waitFor(() => {
      expect(reads.requests).toContain(2);
    });
    expectProfileLoading();
    expect(document.body.textContent ?? "").not.toContain(usernameForId(1));

    release();
    expect(await profileHeading(2)).toBeInTheDocument();
    observer.disconnect();
    expect(
      staleSeen,
      `${usernameForId(1)} appeared while /profile/2 loaded`,
    ).toBe(false);
    expectNoLoading();

    await act(async () => {
      await router.navigate(-1);
    });
    expect(await profileHeading(1)).toBeInTheDocument();
    expect(screen.queryByText(usernameForId(2))).toBeNull();

    await act(async () => {
      await router.navigate(1);
    });
    expect(await profileHeading(2)).toBeInTheDocument();
    expect(screen.queryByText(usernameForId(1))).toBeNull();
    expectNoLoading();
  });
});
