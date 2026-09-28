/**
 * FRONTEND-003 — the cache keys this unit adds, and what it may invalidate.
 *
 * Three entries, and they have to stay three:
 *
 * | what                    | key                          |
 * |-------------------------|------------------------------|
 * | the viewed user         | `["users", <numeric id>]`     |
 * | the caller's follow set | `["users", "me", "following"]` |
 * | the caller's own profile| `PROFILE_QUERY_KEY` (`auth/profile.ts`) |
 *
 * The third is not new and must not be re-invented: `auth/profile.ts` is the one
 * react-query entry for `GET /users/me`, both guards read it, and a second key
 * hands one reader a 404 another has already seen answered ([[0x08-frontend]]).
 *
 * The id is a **number**, because that is what the path parameter is in the
 * generated schema — `["users", "42"]` and `["users", 42]` are two different
 * cache entries, and a page that wrote one and read the other would refetch on
 * every render and never look wrong.
 *
 * Invalidation names exact keys. `invalidateQueries({ queryKey: ["users"] })`
 * would take out every *other* profile the session has looked at as collateral,
 * which is what the last test here is about.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { PROFILE_QUERY_KEY } from "../../auth/profile";
import { FakeAuthService, profileFound, renderWithAuth, teamsAre, testSession } from "../../test/auth";
import { createTestQueryClient } from "../../test/render";
import { server } from "../../test/server";
import {
  VIEWED_USER_ID,
  followStub,
  followingStub,
  publicProfile,
  publicProfileStub,
  usernameForId,
} from "../../test/users";
import { ProfilePage } from "./ProfilePage";

/** Another profile the same session already looked at — the collateral damage. */
const OTHER_USER_ID = 99;

function renderViewingProfile(queryClient = createTestQueryClient()) {
  const viewed = publicProfileStub();
  const following = followingStub([]);
  const follow = followStub();

  server.use(profileFound(), viewed.handler, following.handler, ...follow.handlers);
  renderWithAuth(
    <Routes>
      <Route path="/profile/:userId" element={<ProfilePage />} />
    </Routes>,
    {
      authService: new FakeAuthService({ session: testSession() }),
      route: `/profile/${VIEWED_USER_ID}`,
      queryClient,
    },
  );

  return { queryClient, viewed, following, follow };
}

beforeEach(() => {
  server.use(teamsAre());
});

describe("the cache entries a profile view creates", () => {
  it("caches the viewed user under a numeric-id key", async () => {
    const { queryClient } = renderViewingProfile();

    await screen.findByText("3 followers");

    expect(queryClient.getQueryData(["users", VIEWED_USER_ID])).toMatchObject({
      id: VIEWED_USER_ID,
      username: usernameForId(VIEWED_USER_ID),
    });
    expect(queryClient.getQueryData(["users", String(VIEWED_USER_ID)])).toBeUndefined();
  });

  it("caches the follow set under one key of its own", async () => {
    const { queryClient } = renderViewingProfile();

    await screen.findByRole("button", { name: /^follow$/i });

    expect(queryClient.getQueryData(["users", "me", "following"])).toEqual([]);
  });

  it("leaves the caller's own profile on the shared key", async () => {
    const { queryClient } = renderViewingProfile();

    await screen.findByText("3 followers");

    expect(queryClient.getQueryData(PROFILE_QUERY_KEY)).toMatchObject({ id: 7 });
  });
});

describe("what a follow invalidates", () => {
  it("re-reads the viewed profile and the follow set", async () => {
    const user = userEvent.setup();
    const { viewed, following } = renderViewingProfile();

    following.answerWith([VIEWED_USER_ID]);
    viewed.answerWith(publicProfile({ follower_count: 4 }));
    await user.click(await screen.findByRole("button", { name: /^follow$/i }));

    await waitFor(() => {
      expect(viewed.requests.length).toBeGreaterThan(1);
    });
    expect(following.requests.length).toBeGreaterThan(1);
  });

  it("does not invalidate every other profile in the cache", async () => {
    // `queryKey: ["users"]` is a prefix, and it matches every user this session
    // has looked at. Following one person is not a reason to refetch them all.
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      ["users", OTHER_USER_ID],
      publicProfile({ id: OTHER_USER_ID, username: usernameForId(OTHER_USER_ID) }),
    );

    const { viewed, following } = renderViewingProfile(queryClient);
    following.answerWith([VIEWED_USER_ID]);
    viewed.answerWith(publicProfile({ follower_count: 4 }));
    await user.click(await screen.findByRole("button", { name: /^follow$/i }));

    await waitFor(() => {
      expect(viewed.requests.length).toBeGreaterThan(1);
    });
    expect(queryClient.getQueryState(["users", OTHER_USER_ID])?.isInvalidated).toBe(false);
  });
});
