/**
 * FRONTEND-006 acceptance criteria 1, 3, 4 and 7 — the list itself.
 *
 * 1. The list renders from `GET /notifications`, and an empty response renders
 *    an empty state rather than a spinner or a blank page.
 * 3. Follow, reply and repost each render a distinct message naming the actor,
 *    and an unrecognised type renders a generic entry rather than throwing.
 * 4. The actor's username comes from `GET /users/{user_id}` and is cached, so
 *    several notifications from one actor issue one request for that actor.
 * 7. A reply or repost links to the post it refers to; a follow links to the
 *    actor's profile.
 *
 * **Why the entries are queried as list items.** A notification list is a list,
 * so `<ul>`/`<li>` is what a screen reader should be handed — and it is the one
 * query that lets a test say "this row" without a test id or a class name, which
 * the repo forbids. Everything below that needs a single row uses `within` on
 * one of these.
 *
 * **Why "distinct message" is asserted without pinning the wording.** The three
 * fixtures in that test are all from the *same* actor, so the username cannot be
 * what tells them apart; the only thing left is the message. Comparing the rows'
 * text as a set therefore fails a page that renders "courtside11 did something"
 * three times, without this file deciding what any of the three should say. The
 * row's controls are stripped before comparing, so a per-row "Clear the follow
 * from …" button label cannot make three identical messages look distinct.
 *
 * Nothing here mocks the Cognito SDK or `apiClient`. The session is a double of
 * the `AuthService` interface and every response comes from msw, so the real
 * generated client runs.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import { FakeAuthService, profileFound, renderWithAuth, testSession } from "../../test/auth";
import {
  ACTOR_USER_ID,
  REFERENCED_POST_ID,
  actorProfilesStub,
  clearStub,
  followNotification,
  notificationsStub,
  preferenceStub,
  replyNotification,
  repostNotification,
  unknownTypeNotification,
  type ActorProfilesStub,
  type NotificationsStub,
} from "../../test/notifications";
import { server } from "../../test/server";
import { usernameForId } from "../../test/users";
import { NotificationsPage } from "./NotificationsPage";

type NotificationOut = components["schemas"]["NotificationOut"];

/** A second actor, far enough from the first that neither username is the other's prefix. */
const OTHER_ACTOR_ID = 22;
/** A second post, so two post links in one list are distinguishable. */
const OTHER_POST_ID = 901;

interface Scene {
  list: NotificationsStub;
  actors: ActorProfilesStub;
}

/**
 * A signed-in visitor on `/notifications`, with every endpoint the page can
 * reach already answered.
 *
 * The preference and clear handlers are installed even where this file asserts
 * nothing about them: msw runs with `onUnhandledRequest: "error"`, and a request
 * nobody handled would fail somewhere unrelated to whatever the test is about.
 */
function renderNotifications(notifications: NotificationOut[]): Scene {
  const list = notificationsStub(notifications);
  const actors = actorProfilesStub();

  server.use(
    list.handler,
    actors.handler,
    clearStub().handler,
    ...preferenceStub(true).handlers,
    profileFound(),
  );

  renderWithAuth(<NotificationsPage />, {
    authService: new FakeAuthService({ session: testSession() }),
    route: "/notifications",
  });

  return { list, actors };
}

/**
 * One row's message: its text with the controls taken out.
 *
 * The clone is detached, so removing the buttons cannot affect what is on
 * screen, and nothing here queries by a class name or a test id — `button` is a
 * role, spelled the only way `cloneNode` leaves available.
 */
function messageOf(row: HTMLElement): string {
  const copy = row.cloneNode(true) as HTMLElement;
  for (const control of copy.querySelectorAll("button")) control.remove();
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The rows on screen, re-queried: a row from before a re-render is a detached node. */
function rows(): HTMLElement[] {
  return screen.getAllByRole("listitem");
}

/** The `href` of every link in one row. */
function linksIn(row: HTMLElement): (string | null)[] {
  return within(row)
    .queryAllByRole("link")
    .map((link) => link.getAttribute("href"));
}

describe("the notification list", () => {
  it("renders one entry per notification from GET /notifications", async () => {
    const { list } = renderNotifications([
      followNotification({ id: 1 }),
      replyNotification({ id: 2 }),
      repostNotification({ id: 3 }),
    ]);

    expect(await screen.findAllByRole("listitem")).toHaveLength(3);
    // One read, not one per row: the list is a single query, and a page that
    // refetched per entry would still render three rows.
    expect(list.requests).toHaveLength(1);
  });

  it("renders an empty state for an empty response, not a spinner and not a blank page", async () => {
    renderNotifications([]);

    // All three clauses of the criterion, one assertion each. The heading is
    // awaited first so none of them is read before the page has rendered at all.
    expect(await screen.findByRole("heading", { name: /^notifications$/i })).toBeInTheDocument();
    expect(await screen.findByText(/no notifications/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    // `role="status"` is what a loading indicator announces itself as. An empty
    // list that never leaves that state is the failure this catches: it looks
    // like "still loading" forever and the user never learns there is nothing.
    // Waited for rather than asserted outright, so a spinner that is genuinely
    // on screen while the preference read is still in flight is not counted
    // against a page that then settles.
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});

describe("the three notification types", () => {
  it("renders a distinct message naming the actor for follow, reply and repost", async () => {
    // All three from the same actor on purpose — see the file header. With one
    // actor, the username cannot be what makes the rows differ.
    renderNotifications([
      followNotification({ id: 1 }),
      replyNotification({ id: 2, reference_id: REFERENCED_POST_ID }),
      repostNotification({ id: 3, reference_id: OTHER_POST_ID }),
    ]);

    expect(await screen.findAllByRole("listitem")).toHaveLength(3);

    // Waited for rather than raced: the username arrives from a second request,
    // so reading the messages before it lands compares three rows that are all
    // still missing the one thing each of them has to contain.
    await waitFor(() => {
      for (const row of rows()) {
        expect(messageOf(row), "every entry names the actor it is about").toContain(
          usernameForId(ACTOR_USER_ID),
        );
      }
    });

    const messages = rows().map(messageOf);
    expect(
      new Set(messages).size,
      `follow, reply and repost must not read the same: ${JSON.stringify(messages)}`,
    ).toBe(3);
  });

  it("renders a generic entry for a type it does not recognise, rather than throwing", async () => {
    // The unknown row is in the middle, so a page that threw on it would take
    // the reply below it down too and `findAllByRole` would never see three.
    renderNotifications([
      followNotification({ id: 1 }),
      unknownTypeNotification({ id: 2 }),
      replyNotification({ id: 3 }),
    ]);

    expect(
      await screen.findAllByRole("listitem"),
      "a row it does not understand is dropped, not rendered",
    ).toHaveLength(3);
    // Not blank either: a row rendered as nothing is a dropped row that happens
    // to leave a bullet behind.
    await waitFor(() => {
      expect(messageOf(rows()[1])).not.toBe("");
    });
  });
});

describe("the actor's username", () => {
  it("comes from GET /users/{user_id}", async () => {
    const { actors } = renderNotifications([followNotification({ id: 1 })]);

    await screen.findAllByRole("listitem");
    await waitFor(() => {
      expect(messageOf(rows()[0])).toContain(usernameForId(ACTOR_USER_ID));
    });
    expect(actors.requests).toEqual([ACTOR_USER_ID]);
  });

  it("is fetched once per actor, not once per notification", async () => {
    // Three from one actor and one from another. A `useEffect` fetch per row
    // issues four requests and renders exactly the same thing, which is why the
    // count is the assertion and the rendering is only the precondition.
    const { actors } = renderNotifications([
      followNotification({ id: 1 }),
      replyNotification({ id: 2 }),
      repostNotification({ id: 3 }),
      followNotification({ id: 4, actor_user_id: OTHER_ACTOR_ID }),
    ]);

    await waitFor(() => {
      const messages = rows().map(messageOf);
      expect(messages.filter((text) => text.includes(usernameForId(ACTOR_USER_ID)))).toHaveLength(
        3,
      );
      expect(messages.filter((text) => text.includes(usernameForId(OTHER_ACTOR_ID)))).toHaveLength(
        1,
      );
    });

    expect(actors.timesAsked(ACTOR_USER_ID)).toBe(1);
    expect(actors.timesAsked(OTHER_ACTOR_ID)).toBe(1);
    expect(actors.requests, "two actors, two requests").toHaveLength(2);
  });
});

describe("where an entry links", () => {
  it("links a reply and a repost to the post each refers to", async () => {
    renderNotifications([
      replyNotification({ id: 1, reference_id: REFERENCED_POST_ID }),
      repostNotification({ id: 2, reference_id: OTHER_POST_ID }),
    ]);

    await screen.findAllByRole("listitem");
    await waitFor(() => {
      expect(linksIn(rows()[0])).toContain(`/posts/${REFERENCED_POST_ID}`);
    });
    // The second row's target is a *different* post: a link built from the first
    // row's `reference_id` and a link built from the row's own both satisfy any
    // assertion made against a single row.
    expect(linksIn(rows()[1])).toContain(`/posts/${OTHER_POST_ID}`);
  });

  it("links a follow to the actor's profile, and to no post", async () => {
    // `reference_id` on a follow is the actor's own user id
    // ([[0x05-notifications]]), so a page that sent every `reference_id` to
    // `/posts/` would produce `/posts/11` here and look plausible doing it.
    renderNotifications([followNotification({ id: 1 })]);

    await screen.findAllByRole("listitem");
    await waitFor(() => {
      expect(linksIn(rows()[0])).toContain(`/profile/${ACTOR_USER_ID}`);
    });
    expect(linksIn(rows()[0]).filter((href) => href?.startsWith("/posts/"))).toHaveLength(0);
  });
});
