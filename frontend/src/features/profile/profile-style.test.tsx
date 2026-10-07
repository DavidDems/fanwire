/**
 * UI-008 — both profile variants and the settings card, in the "identity
 * header plus body" template (`wiki/CodeContext/FrontendUI/layout.md` §3,
 * `components.md` §5 rows for `features/profile/*`).
 *
 * What jsdom can honestly show (`verification.md` §2b, §2c): which shared
 * component each piece renders through, read off the class that component's
 * own module exports, and the attributes that carry state (`data-active`,
 * `aria-hidden`). The class assertions are all against the shared modules in
 * `src/components/ui/`, which exist and define those rules; that the profile's
 * own layout CSS exists and is clean is `profile-css.test.ts`.
 *
 * **`ProfileSummary` keeps its three scalar props.** That is the date-of-birth
 * privacy guarantee (`0x08-frontend.md`), so it is rendered here directly with
 * exactly a username and two numbers. The avatar is built from the username it
 * already has.
 *
 * Every `<header>` has the banner role, `ProfileSummary`'s included, so the
 * header is reached from the `h1` with `closest("header")` rather than a
 * page-wide `getByRole("banner")`.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import avatarStyles from "../../components/ui/Avatar.module.css";
import buttonStyles from "../../components/ui/Button.module.css";
import cardStyles from "../../components/ui/Card.module.css";
import messageStyles from "../../components/ui/message.module.css";
import {
  FakeAuthService,
  renderWithAuth,
  teamsAre,
  testProfile,
  testSession,
} from "../../test/auth";
import { patchMeFails, teamsFail } from "../../test/profile";
import { renderWithProviders } from "../../test/render";
import { server } from "../../test/server";
import {
  VIEWED_USERNAME,
  VIEWED_USER_ID,
  followStub,
  followingStub,
  meStub,
  patchMeStub,
  publicProfilesById,
  type FollowStub,
} from "../../test/users";
import { ProfilePage } from "./ProfilePage";
import { ProfileSummary } from "./ProfileSummary";

type MeOut = components["schemas"]["MeOut"];

const OWN_PROFILE: MeOut = testProfile({ description: "Courtside regular." });
const OWN_USERNAME = OWN_PROFILE.username;

const FOLLOW = { name: /^follow$/i } as const;
const UNFOLLOW = { name: /^unfollow$/i } as const;

const SAVED = "Your profile has been saved.";
const NOTHING_TO_SAVE = "There is nothing to save yet.";
const SAVE_FAILED = "We could not save your profile. Please try again.";
const TEAMS_FAILED = "We could not load the list of teams.";
const FOLLOW_FAILED = "We could not update who you follow. Please try again.";

/** The nearest ancestor of `element` (itself included) carrying `className`. */
function ancestorWithClass(
  element: HTMLElement,
  className: string,
): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current !== null) {
    if (current.classList.contains(className)) return current;
    current = current.parentElement;
  }
  return null;
}

/** The status or alert paragraph that holds `text`, whatever wraps the text. */
function messageHolding(text: string, role: "status" | "alert"): HTMLElement {
  const holder = screen
    .getByText(text)
    .closest<HTMLElement>(`[role="${role}"]`);
  if (holder === null) throw new Error(`"${text}" is not inside a ${role}`);
  return holder;
}

/** The text a reader gets from `element`, ignoring the icon's empty SVG. */
function textOf(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The header card around the `h1` naming `username`: a `<header>` ancestor, a
 * `Card` ancestor (which of the two is outer is the implementation's choice:
 * `Card`'s `as` has no `header`), and a large `Avatar` inside that card showing
 * the username's first character as typed.
 */
function expectHeaderCard(username: string): HTMLElement {
  const heading = screen.getByRole("heading", {
    level: 1,
    name: new RegExp(`^${username}$`),
  });

  expect(heading.closest("header"), "the h1 sits in a <header>").not.toBeNull();
  const card = ancestorWithClass(heading, cardStyles.card);
  expect(card, "the h1 sits in a Card").not.toBeNull();

  const avatar = Array.from(
    (card as HTMLElement).querySelectorAll<HTMLElement>("*"),
  ).find(
    (element) =>
      element.classList.contains(avatarStyles.avatar) &&
      element.classList.contains(avatarStyles.lg),
  );
  expect(avatar, "a large Avatar inside the header card").toBeDefined();
  expect(avatar).toHaveAttribute("aria-hidden", "true");
  expect(avatar?.textContent).toBe(Array.from(username)[0]);

  return card as HTMLElement;
}

function signedIn(): FakeAuthService {
  return new FakeAuthService({ session: testSession() });
}

function renderProfilePage(userId: number) {
  return renderWithAuth(
    <Routes>
      <Route path="/profile/:userId" element={<ProfilePage />} />
      <Route path="/sign-in" element={<p>sign-in stub</p>} />
    </Routes>,
    { authService: signedIn(), route: `/profile/${userId}` },
  );
}

/** The signed-in caller on their own profile, with the save answered. */
function renderOwnProfile() {
  const patch = patchMeStub(OWN_PROFILE);
  server.use(
    meStub(OWN_PROFILE).handler,
    patch.handler,
    publicProfilesById(),
    followingStub().handler,
  );
  renderProfilePage(OWN_PROFILE.id);
  return patch;
}

/** The signed-in caller on someone else's profile. */
function renderPublicProfile(followedIds: number[] = []): FollowStub {
  const follow = followStub();
  server.use(
    meStub(OWN_PROFILE).handler,
    publicProfilesById(),
    followingStub(followedIds).handler,
    ...follow.handlers,
  );
  renderProfilePage(VIEWED_USER_ID);
  return follow;
}

/** The own profile's settings card, once the teams have loaded. */
async function settingsCard(): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", {
    level: 2,
    name: /^settings$/i,
  });
  const card = ancestorWithClass(heading, cardStyles.card);
  expect(card, 'the "Settings" h2 sits in a Card').not.toBeNull();
  return card as HTMLElement;
}

/**
 * The form's description box and Save button, found page-wide. The message
 * tests use these rather than `settingsCard()`, so each is red for its own
 * message's styling and not only for the missing card.
 */
async function settingsForm(): Promise<{
  description: HTMLElement;
  save: HTMLElement;
}> {
  const description = await screen.findByRole("textbox", {
    name: /description/i,
  });
  return {
    description,
    save: screen.getByRole("button", { name: /^save$/i }),
  };
}

beforeEach(() => {
  server.use(teamsAre());
});

describe("ProfileSummary, rendered with its three scalars", () => {
  function renderSummary() {
    return renderWithProviders(
      <ProfileSummary
        username="raptorsfan"
        followerCount={12}
        followingCount={3}
      />,
    );
  }

  it("puts the username h1 and a large avatar in a header card", () => {
    renderSummary();

    expectHeaderCard("raptorsfan");
  });

  it("shows the initial as typed, never uppercased", () => {
    renderSummary();

    const card = expectHeaderCard("raptorsfan");
    expect(within(card).queryByText("R")).toBeNull();
  });

  it("keeps the counts as single text nodes, inside the header card", () => {
    renderSummary();

    const card = expectHeaderCard("raptorsfan");
    expect(within(card).getByText("12 followers")).toBeInTheDocument();
    expect(within(card).getByText("3 following")).toBeInTheDocument();
  });
});

describe("the header card on both variants", () => {
  it("heads the own profile", async () => {
    renderOwnProfile();
    await screen.findByRole("heading", { level: 1 });

    const card = expectHeaderCard(OWN_USERNAME);
    expect(within(card).getByText("0 followers")).toBeInTheDocument();
  });

  it("heads someone else's profile", async () => {
    renderPublicProfile();
    await screen.findByRole("button", FOLLOW);

    const card = expectHeaderCard(VIEWED_USERNAME);
    expect(within(card).getByText("3 followers")).toBeInTheDocument();
    expect(within(card).getByText("5 following")).toBeInTheDocument();
  });
});

describe("the follow control", () => {
  it("offers Follow as a primary button, not active", async () => {
    renderPublicProfile([]);

    const button = await screen.findByRole("button", FOLLOW);

    expect(button).toHaveClass(buttonStyles.button, buttonStyles.primary);
    expect(button).not.toHaveClass(buttonStyles.secondary);
    expect(button).not.toHaveAttribute("data-active");
    expect(button).not.toHaveAttribute("aria-pressed");
  });

  it("offers Unfollow as a secondary button carrying data-active", async () => {
    renderPublicProfile([VIEWED_USER_ID]);

    const button = await screen.findByRole("button", UNFOLLOW);

    expect(button).toHaveClass(buttonStyles.button, buttonStyles.secondary);
    expect(button).not.toHaveClass(buttonStyles.primary);
    expect(button).toHaveAttribute("data-active");
    expect(button).not.toHaveAttribute("aria-pressed");
  });

  it("reports a failed follow through InlineAlert, with the same words", async () => {
    const user = userEvent.setup();
    const follow = renderPublicProfile([]);
    follow.fail();

    await user.click(await screen.findByRole("button", FOLLOW));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass(messageStyles.message, messageStyles.danger);
    expect(textOf(alert)).toBe(FOLLOW_FAILED);
  });
});

describe("the settings card", () => {
  it("holds the Settings h2 and the form, apart from the header card", async () => {
    renderOwnProfile();

    const card = await settingsCard();

    expect(
      within(card).getByRole("textbox", { name: /description/i }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("combobox", { name: /preferred team/i }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: /^save$/i }),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("saves through a primary button", async () => {
    renderOwnProfile();

    const { save } = await settingsForm();

    expect(save).toHaveClass(buttonStyles.button, buttonStyles.primary);
  });

  it("says the profile was saved through a success StatusLine", async () => {
    const user = userEvent.setup();
    const patch = renderOwnProfile();

    const { description, save } = await settingsForm();
    await user.clear(description);
    await user.type(description, "Still here for the defence.");
    await user.click(save);

    await waitFor(() => {
      expect(patch.bodies).toHaveLength(1);
    });
    await screen.findByText(SAVED);
    const note = messageHolding(SAVED, "status");
    expect(note).toHaveClass(messageStyles.message, messageStyles.success);
    expect(textOf(note)).toBe(SAVED);
  });

  it("says there is nothing to save through a neutral StatusLine", async () => {
    const user = userEvent.setup();
    renderOwnProfile();

    const { save } = await settingsForm();
    await user.click(save);

    await screen.findByText(NOTHING_TO_SAVE);
    const note = messageHolding(NOTHING_TO_SAVE, "status");
    expect(note).toHaveClass(messageStyles.message, messageStyles.neutral);
    expect(note).not.toHaveClass(messageStyles.success);
    expect(textOf(note)).toBe(NOTHING_TO_SAVE);
  });

  it("reports a failed save through InlineAlert, with the same words", async () => {
    const user = userEvent.setup();
    renderOwnProfile();
    server.use(patchMeFails());

    const { description, save } = await settingsForm();
    await user.clear(description);
    await user.type(description, "New bio.");
    await user.click(save);

    await screen.findByText(SAVE_FAILED);
    const alert = messageHolding(SAVE_FAILED, "alert");
    expect(alert).toHaveClass(messageStyles.message, messageStyles.danger);
    expect(textOf(alert)).toBe(SAVE_FAILED);
  });

  it("reports teams that would not load through InlineAlert", async () => {
    server.use(teamsFail());
    renderOwnProfile();

    await screen.findByText(TEAMS_FAILED);
    const alert = messageHolding(TEAMS_FAILED, "alert");
    expect(alert).toHaveClass(messageStyles.message, messageStyles.danger);
    expect(textOf(alert)).toBe(TEAMS_FAILED);
  });
});
