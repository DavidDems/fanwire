/**
 * FRONTEND-003 acceptance criteria 4, 5, 6 and 8 — the follow relationship.
 *
 * Follow state comes from `GET /users/me/following` (a bare `list[int]`,
 * [[0x01-users]]); following is `POST /users/{user_id}/follow` and unfollowing
 * is `DELETE` on the same path.
 *
 * **What "optimistic" is pinned to mean.** The button *and* the follower count
 * change before the request returns, and both are restored if it fails. Those
 * are the two things a user sees change, so the rollback test asserts both. The
 * requests are held open deliberately here rather than raced: a page that only
 * updated once the response landed would leave the held assertion timing out,
 * which is the point.
 *
 * **Anonymous visitors.** A public profile is a read path and stays readable
 * signed out ([[0x01-users]] Security), so the control still renders — but using
 * it sends the visitor to sign-in carrying where they were, the same convention
 * `routes/guards.tsx` uses. It must not fire an unauthenticated write and show
 * them a 401, so the follow endpoint is given a recording handler here and
 * asserted to have seen nothing. (`onUnhandledRequest: "error"` would catch it
 * too; this says so out loud rather than relying on an omission.)
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import type { AuthService } from "../../auth/AuthService";
import {
  FakeAuthService,
  profileFound,
  renderWithAuth,
  teamsAre,
  testSession,
} from "../../test/auth";
import { server } from "../../test/server";
import {
  VIEWED_USERNAME,
  VIEWED_USER_ID,
  followStub,
  followingStub,
  meStub,
  publicProfile,
  publicProfileStub,
  type FollowStub,
  type FollowingStub,
  type PublicProfileStub,
} from "../../test/users";
import { ProfilePage } from "./ProfilePage";

const VIEWED_HEADING = new RegExp(`^${VIEWED_USERNAME}$`, "i");
const FOLLOW = { name: /^follow$/i } as const;
const UNFOLLOW = { name: /^unfollow$/i } as const;

interface Scene {
  viewed: PublicProfileStub;
  following: FollowingStub;
  follow: FollowStub;
}

function SignInStub() {
  const { state } = useLocation();
  const from = (state as { from?: { pathname?: string } } | null)?.from;
  return <p>sign-in stub, sent from {from?.pathname ?? "nowhere"}</p>;
}

function renderProfile(authService: AuthService) {
  return renderWithAuth(
    <Routes>
      <Route path="/profile/:userId" element={<ProfilePage />} />
      <Route path="/sign-in" element={<SignInStub />} />
    </Routes>,
    { authService, route: `/profile/${VIEWED_USER_ID}` },
  );
}

/** A signed-in visitor looking at someone else's profile. */
function signedInScene(followedIds: number[] = []): Scene {
  const viewed = publicProfileStub();
  const following = followingStub(followedIds);
  const follow = followStub();

  server.use(profileFound(), viewed.handler, following.handler, ...follow.handlers);
  renderProfile(new FakeAuthService({ session: testSession() }));

  return { viewed, following, follow };
}

beforeEach(() => {
  server.use(teamsAre());
});

describe("the follow control's starting state", () => {
  it("offers Follow when the follow set does not contain this user", async () => {
    signedInScene([]);

    expect(await screen.findByRole("button", FOLLOW)).toBeInTheDocument();
  });

  it("offers Unfollow when the follow set does contain this user", async () => {
    signedInScene([VIEWED_USER_ID]);

    expect(await screen.findByRole("button", UNFOLLOW)).toBeInTheDocument();
  });

  it("reads that state from GET /users/me/following", async () => {
    const { following } = signedInScene([VIEWED_USER_ID]);

    await screen.findByRole("button", UNFOLLOW);
    expect(following.requests).toHaveLength(1);
  });
});

describe("following and unfollowing", () => {
  it("issues POST /users/{user_id}/follow", async () => {
    const user = userEvent.setup();
    const { follow, following, viewed } = signedInScene([]);

    // The overrides go in only once the starting state has actually been
    // served. msw answers asynchronously and the session resolves a microtask
    // later, so installing them before the first read lands means the page
    // never sees the state this test is about.
    const button = await screen.findByRole("button", FOLLOW);
    following.answerWith([VIEWED_USER_ID]);
    viewed.answerWith(publicProfile({ follower_count: 4 }));

    await user.click(button);

    await waitFor(() => {
      expect(follow.calls).toEqual([{ method: "POST", userId: VIEWED_USER_ID }]);
    });
  });

  it("issues DELETE /users/{user_id}/follow", async () => {
    const user = userEvent.setup();
    const { follow, following, viewed } = signedInScene([VIEWED_USER_ID]);

    const button = await screen.findByRole("button", UNFOLLOW);
    following.answerWith([]);
    viewed.answerWith(publicProfile({ follower_count: 2 }));

    await user.click(button);

    await waitFor(() => {
      expect(follow.calls).toEqual([{ method: "DELETE", userId: VIEWED_USER_ID }]);
    });
  });

  it("flips the button and raises the follower count before the follow returns", async () => {
    const user = userEvent.setup();
    const { follow, following, viewed } = signedInScene([]);

    // Starting state first, then the overrides the refetch will find — see the
    // note on "issues POST" above.
    await screen.findByText("3 followers");
    following.answerWith([VIEWED_USER_ID]);
    viewed.answerWith(publicProfile({ follower_count: 4 }));
    const release = follow.hold();

    await user.click(screen.getByRole("button", FOLLOW));

    expect(await screen.findByRole("button", UNFOLLOW)).toBeInTheDocument();
    expect(screen.getByText("4 followers")).toBeInTheDocument();
    // Following *them* does not change how many people they follow.
    expect(screen.getByText("5 following")).toBeInTheDocument();

    release();
    await waitFor(() => {
      expect(viewed.requests.length).toBeGreaterThan(1);
    });
  });

  it("flips the button and lowers the follower count before the unfollow returns", async () => {
    const user = userEvent.setup();
    const { follow, following, viewed } = signedInScene([VIEWED_USER_ID]);

    await screen.findByText("3 followers");
    following.answerWith([]);
    viewed.answerWith(publicProfile({ follower_count: 2 }));
    const release = follow.hold();

    await user.click(screen.getByRole("button", UNFOLLOW));

    expect(await screen.findByRole("button", FOLLOW)).toBeInTheDocument();
    expect(screen.getByText("2 followers")).toBeInTheDocument();

    release();
    await waitFor(() => {
      expect(viewed.requests.length).toBeGreaterThan(1);
    });
  });

  it("re-derives the counts from the server once the follow settles", async () => {
    // The optimistic guess is 4. The server is the one that decides, and it
    // says 9 — somebody else followed them while this request was in flight.
    const user = userEvent.setup();
    const { following, viewed } = signedInScene([]);

    await screen.findByText("3 followers");
    following.answerWith([VIEWED_USER_ID]);
    viewed.answerWith(publicProfile({ follower_count: 9, following_count: 6 }));

    await user.click(screen.getByRole("button", FOLLOW));

    expect(await screen.findByText("9 followers")).toBeInTheDocument();
    expect(screen.getByText("6 following")).toBeInTheDocument();
    expect(screen.getByRole("button", UNFOLLOW)).toBeInTheDocument();
    expect(following.requests.length).toBeGreaterThan(1);
  });
});

describe("a follow that fails", () => {
  it("restores the button and the follower count, and says so", async () => {
    const user = userEvent.setup();
    const { follow } = signedInScene([]);
    follow.fail();

    await screen.findByText("3 followers");
    await user.click(screen.getByRole("button", FOLLOW));

    const failure = await screen.findByRole("alert");
    expect(failure.textContent?.trim()).not.toBe("");
    expect(await screen.findByRole("button", FOLLOW)).toBeInTheDocument();
    expect(await screen.findByText("3 followers")).toBeInTheDocument();
  });

  it("restores the button and the follower count after a failed unfollow", async () => {
    const user = userEvent.setup();
    const { follow } = signedInScene([VIEWED_USER_ID]);
    follow.fail();

    await screen.findByText("3 followers");
    await user.click(screen.getByRole("button", UNFOLLOW));

    const failure = await screen.findByRole("alert");
    expect(failure.textContent?.trim()).not.toBe("");
    expect(await screen.findByRole("button", UNFOLLOW)).toBeInTheDocument();
    expect(await screen.findByText("3 followers")).toBeInTheDocument();
  });
});

describe("an anonymous visitor", () => {
  it("can read the public profile", async () => {
    server.use(publicProfileStub().handler);

    renderProfile(new FakeAuthService());

    expect(await screen.findByRole("heading", { name: VIEWED_HEADING })).toBeInTheDocument();
    expect(screen.getByText("3 followers")).toBeInTheDocument();
  });

  it("is sent to sign-in by the follow control, carrying where they were", async () => {
    const user = userEvent.setup();
    const follow = followStub();
    server.use(publicProfileStub().handler, ...follow.handlers);

    renderProfile(new FakeAuthService());
    await user.click(await screen.findByRole("button", FOLLOW));

    expect(
      await screen.findByText(`sign-in stub, sent from /profile/${VIEWED_USER_ID}`),
    ).toBeInTheDocument();
    expect(follow.calls).toEqual([]);
  });

  it("makes no authenticated request at all", async () => {
    // Not one of these is answerable without a token, and the 401 would be a
    // failure the page then has to explain away.
    const user = userEvent.setup();
    const me = meStub();
    const following = followingStub();
    const follow = followStub();
    server.use(me.handler, following.handler, publicProfileStub().handler, ...follow.handlers);

    renderProfile(new FakeAuthService());
    await user.click(await screen.findByRole("button", FOLLOW));
    await screen.findByText(/sign-in stub/);

    expect(me.requests).toEqual([]);
    expect(following.requests).toEqual([]);
    expect(follow.calls).toEqual([]);
  });
});
