/**
 * FRONTEND-003 acceptance criteria 2 and 3 — settings, on the own-profile view.
 *
 * `PATCH /users/me` is a patch, and the backend reads it with `model_fields_set`
 * semantics ([[0x01c-users-routes]]): a field **absent** from the body is left
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
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
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
import avatarStyles from "../../components/ui/Avatar.module.css";
import buttonStyles from "../../components/ui/Button.module.css";
import {
  isAtRule,
  parseCss,
  readSrcFile,
  selectors,
  type CssBlock,
} from "../../test/css";
import profileStyles from "./Profile.module.css";
import { ProfilePage } from "./ProfilePage";

type MeOut = components["schemas"]["MeOut"];

const OWN_DESCRIPTION = "Season-ticket holder since 2014.";

/** The signed-in user, with both editable fields already set to something. */
const OWN_PROFILE: MeOut = testProfile({
  description: OWN_DESCRIPTION,
  preferred_team_id: 1,
});

function renderSettings(profile: MeOut = OWN_PROFILE): PatchMeStub {
  const patch = patchMeStub(profile);
  server.use(
    meStub(profile).handler,
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
      route: `/profile/${profile.id}`,
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

/** The avatar section: the fieldset its "Profile avatar" legend names. */
function avatarSection(): HTMLElement {
  return screen.getByRole("group", { name: "Profile avatar" });
}

function innerGroup(): Promise<HTMLElement> {
  return screen.findByRole("radiogroup", { name: "Inner colour" });
}

function outerGroup(): HTMLElement {
  return screen.getByRole("radiogroup", { name: "Outer colour" });
}

/** The Preview: the one Avatar inside the avatar section. */
function preview(): HTMLElement {
  const avatars = avatarSection().querySelectorAll<HTMLElement>(`.${avatarStyles.avatar}`);
  expect(avatars, "exactly one Avatar, the Preview, in the avatar section").toHaveLength(1);
  return avatars[0];
}

function labelText(radio: HTMLElement): string {
  return (radio as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? "";
}

/**
 * The declarations Profile.module.css gives `element` through its module
 * classes: every top-level rule one of whose selectors is exactly one of them.
 */
function declarationsOf(css: CssBlock[], element: HTMLElement): Map<string, string> {
  // The module object is a proxy under Vitest, so map each rule's class to
  // the name the component used, not the other way round.
  const applies = (selector: string): boolean => {
    const match = /^\.([\w-]+)$/.exec(selector);
    return match !== null && element.classList.contains(profileStyles[match[1]]);
  };
  const declared = new Map<string, string>();
  for (const block of css.filter((one) => !isAtRule(one))) {
    if (!selectors(block).some(applies)) continue;
    for (const { property, value } of block.declarations) declared.set(property, value.trim());
  }
  return declared;
}

/** A length in rem: `1.5rem`, `24px` (at 16 px), or the target token. */
function remOf(declared: Map<string, string>, property: string): number {
  const value = declared.get(property) ?? "";
  if (/^var\(--target-min\)$/.test(value)) return 2.75;
  const rem = /^([\d.]+)rem$/.exec(value);
  if (rem !== null) return Number(rem[1]);
  const px = /^([\d.]+)px$/.exec(value);
  if (px !== null) return Number(px[1]) / 16;
  return 0;
}

beforeEach(() => {
  server.use(teamsAre());
});

describe("the settings form", () => {
  it("keeps the profile form but has no Account section or deactivation action", async () => {
    renderSettings();

    expect(await description()).toHaveValue(OWN_DESCRIPTION);
    expect(screen.queryByRole("heading", { name: /^account$/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /deactivate account/i }),
    ).toBeNull();
  });

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

    // The awaited lookup is hoisted out of the argument list on purpose:
    // arguments evaluate left to right, so `preferredTeam()` — a `getByRole` —
    // would otherwise run on the first tick, against a page still showing its
    // loading status. Which variant to render is not knowable synchronously.
    const suns = await screen.findByRole("option", { name: "Phoenix Suns" });
    await user.selectOptions(preferredTeam(), suns);
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

    const suns = await screen.findByRole("option", { name: "Phoenix Suns" });
    await user.selectOptions(preferredTeam(), suns);
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

  it("keeps the avatar fieldset, its legend, Preview and Save", async () => {
    renderSettings();
    await description();

    const avatar = avatarSection();
    expect(within(avatar).getByText("Preview")).toBeInTheDocument();
    expect(preview()).toBeDefined();
    // Button md is --target-min (2.75rem, 44 px) high (Button.module.css).
    expect(save()).toHaveClass(buttonStyles.button, buttonStyles.md);
  });

  it("offers separate labelled keyboard-operable inner and outer radio groups", async () => {
    const user = userEvent.setup();
    renderSettings();

    const inner = await innerGroup();
    const outer = outerGroup();
    expect(avatarSection()).toContainElement(inner);
    expect(avatarSection()).toContainElement(outer);
    const innerChoices = within(inner).getAllByRole("radio");
    const outerChoices = within(outer).getAllByRole("radio");
    // Each choice's visible label is its colour's name, so the selection
    // never relies on colour alone.
    expect(innerChoices.map(labelText)).toEqual([
      "None", "Gold", "Orange", "Red", "Green", "Sky Blue", "Lavender", "Silver", "Teal",
    ]);
    expect(outerChoices.map(labelText)).toEqual([
      "None", "Blue", "Crimson", "Black", "Purple", "Forest Green",
    ]);
    expect(innerChoices[0]).toBeChecked();
    expect(outerChoices[0]).toBeChecked();

    await user.click(innerChoices[0]);
    await user.keyboard("{ArrowDown}");
    expect(innerChoices[1]).toBeChecked();
    expect(innerChoices[1]).toHaveFocus();
    expect(outerChoices[0]).toBeChecked();

    await user.click(outerChoices[0]);
    await user.keyboard("{ArrowDown}");
    expect(outerChoices[1]).toBeChecked();
    expect(innerChoices[1]).toBeChecked();
  });

  it("gives every choice a target of at least 24 by 24 CSS px", async () => {
    renderSettings();
    const radios = [
      ...within(await innerGroup()).getAllByRole("radio"),
      ...within(outerGroup()).getAllByRole("radio"),
    ];
    const css = parseCss(readSrcFile("features/profile/Profile.module.css"));

    for (const radio of radios) {
      const label = (radio as HTMLInputElement).labels?.[0];
      expect(label, `${labelText(radio)} has a label`).toBeDefined();
      const declared = declarationsOf(css, label as HTMLElement);
      expect(remOf(declared, "min-height"), `${labelText(radio)} min-height`).toBeGreaterThanOrEqual(1.5);
      expect(remOf(declared, "min-width"), `${labelText(radio)} min-width`).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("lets the groups wrap, so they reflow at 320 px without page overflow", async () => {
    renderSettings();
    const css = parseCss(readSrcFile("features/profile/Profile.module.css"));

    for (const group of [await innerGroup(), outerGroup()]) {
      const list = within(group).getAllByRole("radio")[0].closest("label")?.parentElement;
      expect(list, "the choices' container").toBeDefined();
      const declared = declarationsOf(css, list as HTMLElement);
      const wraps =
        declared.get("flex-wrap") === "wrap" ||
        /repeat\(\s*auto-(fill|fit)/.test(declared.get("grid-template-columns") ?? "");
      expect(wraps, "the choices wrap onto further rows").toBe(true);
    }
  });

  it("updates the preview as the choice changes, and saves only the changed inner colour", async () => {
    const user = userEvent.setup();
    const patch = renderSettings();
    await innerGroup();
    expect(preview().getAttribute("style")).toBeNull();

    await user.click(within(await innerGroup()).getByRole("radio", { name: "Gold" }));
    expect(preview().style.backgroundColor).toBe("var(--team-inner-gold)");
    expect(preview().style.color).toBe("var(--team-outer-black)");
    expect(preview().style.borderColor).toBe("");

    await user.click(within(outerGroup()).getByRole("radio", { name: "Forest Green" }));
    expect(preview().style.borderColor).toBe("var(--team-outer-forest)");
    await user.click(within(outerGroup()).getByRole("radio", { name: "None" }));
    expect(preview().style.borderColor).toBe("");

    await user.click(save());

    await waitFor(() => expect(patch.bodies).toHaveLength(1));
    expect(patch.onlyBody()).toEqual({ avatar_inner_color: "gold" });
  });

  it("sends only the outer colour when only the outer colour changed", async () => {
    const user = userEvent.setup();
    const patch = renderSettings(testProfile({ avatar_inner_color: "sky", avatar_outer_color: null }));
    await innerGroup();
    await user.click(within(outerGroup()).getByRole("radio", { name: "Crimson" }));
    await user.click(save());

    await waitFor(() => expect(patch.bodies).toHaveLength(1));
    expect(patch.onlyBody()).toEqual({ avatar_outer_color: "crimson" });
  });

  it("sends null only for an explicitly cleared colour", async () => {
    const user = userEvent.setup();
    const resetPatch = renderSettings(testProfile({ avatar_inner_color: "sky", avatar_outer_color: "blue" }));
    const inner = await innerGroup();
    expect(within(inner).getByRole("radio", { name: "Sky Blue" })).toBeChecked();
    expect(within(outerGroup()).getByRole("radio", { name: "Blue" })).toBeChecked();
    await user.click(within(inner).getByRole("radio", { name: "None" }));
    await user.click(save());
    await waitFor(() => expect(resetPatch.bodies).toHaveLength(1));
    expect(resetPatch.onlyBody()).toEqual({ avatar_inner_color: null });
  });

  it("restores saved colours and reports a failed save", async () => {
    const user = userEvent.setup();
    const profile = testProfile({ avatar_inner_color: "sky", avatar_outer_color: "blue" });
    server.use(
      meStub(profile).handler,
      http.patch("*/users/me", () => HttpResponse.json({}, { status: 500 })),
      publicProfilesById(),
    );
    renderWithAuth(
      <Routes><Route path="/profile/:userId" element={<ProfilePage />} /></Routes>,
      { authService: new FakeAuthService({ session: testSession() }), route: `/profile/${profile.id}` },
    );
    const inner = await innerGroup();
    expect(within(inner).getByRole("radio", { name: "Sky Blue" })).toBeChecked();
    await user.click(within(inner).getByRole("radio", { name: "Gold" }));
    await user.click(within(outerGroup()).getByRole("radio", { name: "Purple" }));
    expect(preview().style.backgroundColor).toBe("var(--team-inner-gold)");
    await user.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save/i);
    expect(within(inner).getByRole("radio", { name: "Sky Blue" })).toBeChecked();
    expect(within(inner).getByRole("radio", { name: "Gold" })).not.toBeChecked();
    expect(within(outerGroup()).getByRole("radio", { name: "Blue" })).toBeChecked();
    expect(preview().style.backgroundColor).toBe("var(--team-inner-sky)");
    expect(preview().style.borderColor).toBe("var(--team-outer-blue)");
  });

  it("shows None as each group's default choice", async () => {
    renderSettings();

    expect(within(await innerGroup()).getByRole("radio", { name: "None" })).toBeChecked();
    expect(within(outerGroup()).getByRole("radio", { name: "None" })).toBeChecked();
    expect(screen.getAllByRole("radio", { name: "None" })).toHaveLength(2);
  });

  it("offers none of the old presets, and never sends the picture", async () => {
    const user = userEvent.setup();
    const patch = renderSettings();
    await innerGroup();

    expect(screen.queryByRole("radio", { name: /use initials|court lines|net grid/i })).toBeNull();
    await user.click(within(outerGroup()).getByRole("radio", { name: "Black" }));
    await user.click(save());
    await waitFor(() => expect(patch.bodies).toHaveLength(1));
    expect(patch.onlyBody()).toEqual({ avatar_outer_color: "black" });
  });
});
