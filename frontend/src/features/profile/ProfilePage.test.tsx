/**
 * FRONTEND-003 acceptance criteria 1 and 7 — the two variants of one route.
 *
 * `/profile/:userId` is a single, public route pinned by `FRONTEND-001`
 * ([[0x08-frontend]] "Contracts the foundation pins"). It renders the **own**
 * profile when the id in the path is the signed-in user's, and the **public**
 * profile otherwise. There is no second route and no `/settings`.
 *
 * **Date of birth is private** ([[0x01-users]] Security; [[0x08-frontend]]
 * "Settled contracts"). The backend leaked it once already and was fixed by
 * splitting `PublicUserOut` off `MeOut`; the frontend is the second place the
 * same leak happens, by rendering one header that takes a whole user object and
 * shows every field it finds. So the public variant is asserted against the
 * *rendered text*, not against which component was used — and it is asserted
 * while signed in, when the caller's own `MeOut` (date of birth and all) is
 * genuinely in the cache and a careless header would have it to hand.
 */
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import type { AuthService } from "../../auth/AuthService";
import {
  FakeAuthService,
  renderWithAuth,
  teamsAre,
  testProfile,
  testSession,
} from "../../test/auth";
import { server } from "../../test/server";
import {
  VIEWED_USERNAME,
  VIEWED_USER_ID,
  followingStub,
  meStub,
  publicProfileStub,
  publicProfilesById,
  type MeStub,
} from "../../test/users";
import { ProfilePage } from "./ProfilePage";

/** The signed-in user: id 7, `date_of_birth` 1994-04-05. */
const OWN_USER_ID = testProfile().id;
const OWN_USERNAME = testProfile().username;
const OWN_DATE_OF_BIRTH = testProfile().date_of_birth;

/**
 * Every way 1994-04-05 could plausibly reach the page.
 *
 * The year on its own is the one that matters: no other fixture in this file
 * contains it, so any rendering of the date at all — ISO, locale-formatted,
 * long-form — puts "1994" in the document.
 */
const DATE_OF_BIRTH_TRACES = [OWN_DATE_OF_BIRTH, "1994", "April", "04/05", "05/04", "4/5"];

function renderProfile(userId: number, authService: AuthService) {
  return renderWithAuth(
    <Routes>
      <Route path="/profile/:userId" element={<ProfilePage />} />
      <Route path="/sign-in" element={<p>sign-in stub</p>} />
    </Routes>,
    { authService, route: `/profile/${userId}` },
  );
}

function signedIn(): FakeAuthService {
  return new FakeAuthService({ session: testSession() });
}

/**
 * The reads a signed-in visitor's profile page makes, with `GET /users/me`
 * counted. The public read is id-aware, so it answers correctly whichever
 * variant is on screen.
 */
function signedInReads(): MeStub {
  const me = meStub();
  server.use(me.handler, publicProfilesById(), followingStub().handler);
  return me;
}

beforeEach(() => {
  // The preferred team is an FK into `events/`, so any rendering of it is a
  // second request; installed everywhere so an unhandled one never stands in
  // for the assertion this file is actually making.
  server.use(teamsAre());
});

describe("the public profile variant", () => {
  it("is headed by the viewed user's username", async () => {
    signedInReads();

    renderProfile(VIEWED_USER_ID, signedIn());

    expect(
      await screen.findByRole("heading", { name: new RegExp(`^${VIEWED_USERNAME}$`, "i") }),
    ).toBeInTheDocument();
  });

  it("reads GET /users/{user_id} for the id in the path", async () => {
    const me = meStub();
    const viewed = publicProfileStub();
    server.use(me.handler, viewed.handler, followingStub().handler);

    renderProfile(VIEWED_USER_ID, signedIn());
    await screen.findByRole("heading", { name: new RegExp(`^${VIEWED_USERNAME}$`, "i") });

    expect(viewed.requests).toContain(VIEWED_USER_ID);
  });

  it("renders no date of birth anywhere, in any format", async () => {
    // Signed in on purpose: the caller's own `MeOut` is in the cache here, so a
    // shared "whole user object" header would have the date available to leak.
    signedInReads();

    renderProfile(VIEWED_USER_ID, signedIn());
    await screen.findByRole("heading", { name: new RegExp(`^${VIEWED_USERNAME}$`, "i") });

    const rendered = document.body.textContent ?? "";
    for (const trace of DATE_OF_BIRTH_TRACES) {
      expect(rendered, `the public profile must not render ${trace}`).not.toContain(trace);
    }
    expect(screen.queryAllByText(/date of birth/i)).toHaveLength(0);
  });

  it("renders the follower and following counts the API reported", async () => {
    signedInReads();

    renderProfile(VIEWED_USER_ID, signedIn());

    expect(await screen.findByText("3 followers")).toBeInTheDocument();
    expect(screen.getByText("5 following")).toBeInTheDocument();
  });
});

describe("the own profile variant", () => {
  it("renders the caller's own date of birth", async () => {
    signedInReads();

    renderProfile(OWN_USER_ID, signedIn());

    expect(
      await screen.findByRole("heading", { name: new RegExp(`^${OWN_USERNAME}$`, "i") }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/date of birth/i).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").toContain("1994");
  });

  it("reads it from the one shared GET /users/me, not a second query", async () => {
    // `auth/profile.ts` is the single react-query entry for this request
    // ([[0x08-frontend]]): a second key hands one reader an answer another has
    // already seen, and costs a duplicate round trip on every profile view.
    const me = signedInReads();

    renderProfile(OWN_USER_ID, signedIn());
    await screen.findByRole("heading", { name: new RegExp(`^${OWN_USERNAME}$`, "i") });

    expect(me.requests).toHaveLength(1);
  });

  it("renders no follow control on the signed-in user's own profile", async () => {
    signedInReads();

    renderProfile(OWN_USER_ID, signedIn());
    await screen.findByRole("heading", { name: new RegExp(`^${OWN_USERNAME}$`, "i") });

    expect(screen.queryByRole("button", { name: /follow/i })).toBeNull();
  });

  it("renders the settings form, which the public variant does not", async () => {
    signedInReads();

    renderProfile(OWN_USER_ID, signedIn());

    expect(await screen.findByRole("textbox", { name: /description/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /preferred team/i })).toBeInTheDocument();
  });

  it("keeps the settings form off another user's profile", async () => {
    signedInReads();

    renderProfile(VIEWED_USER_ID, signedIn());
    await screen.findByRole("heading", { name: new RegExp(`^${VIEWED_USERNAME}$`, "i") });

    expect(screen.queryByRole("textbox", { name: /description/i })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /preferred team/i })).toBeNull();
  });
});
