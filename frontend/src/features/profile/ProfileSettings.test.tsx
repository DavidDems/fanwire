/**
 * FRONTEND-003 acceptance criteria 2 and 3 — settings, on the own-profile view.
 *
 * `PATCH /users/me` is a patch, and the backend reads it with `model_fields_set`
 * semantics ([[0x01-users]]): a field **absent** from the body is left
 * untouched, while a field present as `null` *clears* it. Those are two
 * different requests, and only the raw parsed body distinguishes them — so
 * every assertion here is about which keys are in the body, not about which
 * values are non-null.
 *
 * `preferred_team_id` is a real FK into `events/`'s `Team` table, so the choices
 * come from `GET /events/teams` and what is submitted is the id.
 *
 * There is no profile-picture control in this unit: the upload widget belongs to
 * `FRONTEND-004` and a second uploader here would be a duplicate media path
 * ([[0x00-architecture]] Connection rule). `profile_picture_media_id` is
 * therefore asserted *absent* from every body this form sends.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import {
  FakeAuthService,
  renderWithAuth,
  teamsAre,
  testProfile,
  testSession,
} from "../../test/auth";
import { server } from "../../test/server";
import {
  followingStub,
  meStub,
  patchMeStub,
  publicProfilesById,
  type PatchMeStub,
} from "../../test/users";
import { ProfilePage } from "./ProfilePage";

type MeOut = components["schemas"]["MeOut"];

const OWN_DESCRIPTION = "Season-ticket holder since 2014.";

/** The signed-in user, with both editable fields already set to something. */
const OWN_PROFILE: MeOut = testProfile({
  description: OWN_DESCRIPTION,
  preferred_team_id: 1,
});

function renderSettings(): PatchMeStub {
  const patch = patchMeStub(OWN_PROFILE);
  server.use(
    meStub(OWN_PROFILE).handler,
    patch.handler,
    publicProfilesById(),
    followingStub().handler,
  );

  renderWithAuth(
    <Routes>
      <Route path="/profile/:userId" element={<ProfilePage />} />
    </Routes>,
    {
      authService: new FakeAuthService({ session: testSession() }),
      route: `/profile/${OWN_PROFILE.id}`,
    },
  );

  return patch;
}

function description(): Promise<HTMLElement> {
  return screen.findByRole("textbox", { name: /description/i });
}

function preferredTeam(): HTMLElement {
  return screen.getByRole("combobox", { name: /preferred team/i });
}

function save(): HTMLElement {
  return screen.getByRole("button", { name: /save/i });
}

beforeEach(() => {
  server.use(teamsAre());
});

describe("the settings form", () => {
  it("prefills from the caller's own profile", async () => {
    renderSettings();

    expect(await description()).toHaveValue(OWN_DESCRIPTION);
    expect(preferredTeam()).toHaveValue(String(OWN_PROFILE.preferred_team_id));
  });

  it("offers the teams GET /events/teams returns", async () => {
    renderSettings();

    expect(await screen.findByRole("option", { name: "Toronto Raptors" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Phoenix Suns" })).toBeInTheDocument();
  });

  it("sends only the description when only the description changed", async () => {
    const user = userEvent.setup();
    const patch = renderSettings();

    await user.clear(await description());
    await user.type(await description(), "Still here for the defence.");
    await user.click(save());

    await waitFor(() => {
      expect(patch.bodies).toHaveLength(1);
    });
    const body = patch.onlyBody();
    expect(body.description).toBe("Still here for the defence.");
    // Untouched, so absent — not `null`, which would clear it.
    expect("preferred_team_id" in body).toBe(false);
    expect("profile_picture_media_id" in body).toBe(false);
  });

  it("sends only the preferred team when only the team changed", async () => {
    const user = userEvent.setup();
    const patch = renderSettings();

    await user.selectOptions(
      preferredTeam(),
      await screen.findByRole("option", { name: "Phoenix Suns" }),
    );
    await user.click(save());

    await waitFor(() => {
      expect(patch.bodies).toHaveLength(1);
    });
    const body = patch.onlyBody();
    expect("description" in body).toBe(false);
    expect("profile_picture_media_id" in body).toBe(false);
  });

  it("submits the preferred team as its numeric id, not its name", async () => {
    const user = userEvent.setup();
    const patch = renderSettings();

    await user.selectOptions(
      preferredTeam(),
      await screen.findByRole("option", { name: "Phoenix Suns" }),
    );
    await user.click(save());

    await waitFor(() => {
      expect(patch.bodies).toHaveLength(1);
    });
    expect(patch.onlyBody().preferred_team_id).toBe(2);
  });

  it("sends both fields when both changed", async () => {
    const user = userEvent.setup();
    const patch = renderSettings();

    await user.clear(await description());
    await user.type(await description(), "New bio.");
    await user.selectOptions(
      preferredTeam(),
      await screen.findByRole("option", { name: "Phoenix Suns" }),
    );
    await user.click(save());

    await waitFor(() => {
      expect(patch.bodies).toHaveLength(1);
    });
    expect(patch.onlyBody()).toEqual({
      description: "New bio.",
      preferred_team_id: 2,
    });
  });

  it("does not offer a profile-picture control in this unit", async () => {
    // FRONTEND-004 owns the uploader. Building a second one here would be a
    // duplicate media path, and would then need deleting rather than merging.
    renderSettings();
    await description();

    expect(screen.queryByLabelText(/picture|photo|avatar/i)).toBeNull();
  });
});
