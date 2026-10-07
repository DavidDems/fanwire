/**
 * UI-007 — the notifications page as a settings strip plus one divided list
 * card (`wiki/CodeContext/FrontendUI/layout.md` §3, `components.md` §5 rows
 * for `features/notifications/*`).
 *
 * What jsdom can honestly show (`verification.md` §2b, §2c): which shared
 * component each piece renders through, read off the class that component's
 * own module exports, and the attributes that carry state (`aria-hidden`).
 * Every class asserted here belongs to a shared module in
 * `src/components/ui/`; that those rules exist on disk, that the page's own
 * module CSS is clean, and that it draws the dividers between rows is
 * `notifications-css.test.ts`.
 *
 * **The clear mutation stays on the page** (`0x08-frontend.md`). Nothing here
 * depends on where it lives: the failure is driven through the network stub
 * and read off the screen.
 *
 * Network through msw only (`src/test/server.ts`, `src/test/notifications.ts`).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import buttonStyles from "../../components/ui/Button.module.css";
import cardStyles from "../../components/ui/Card.module.css";
import emptyStyles from "../../components/ui/EmptyState.module.css";
import messageStyles from "../../components/ui/message.module.css";
import { FakeAuthService, profileFound, renderWithAuth, testSession } from "../../test/auth";
import {
  ACTOR_USER_ID,
  actorProfilesStub,
  clearStub,
  followNotification,
  notificationsStub,
  preferenceStub,
  replyNotification,
  repostNotification,
  type ClearStub,
} from "../../test/notifications";
import { server } from "../../test/server";
import { usernameForId } from "../../test/users";
import { NotificationsPage } from "./NotificationsPage";

type NotificationOut = components["schemas"]["NotificationOut"];

/** `GET /notifications`, anchored the way `src/test/notifications.ts` anchors it. */
const NOTIFICATIONS_PATH = /\/notifications$/;

const LOADING = "Loading your notifications…";
const LOAD_FAILED = "We could not load your notifications. Please try again.";
const EMPTY = "You have no notifications.";
const CLEAR_FAILED = "We could not clear that notification. Please try again.";
const EMAIL_LABEL = "Email me about new notifications";

function threeNotifications(): NotificationOut[] {
  return [
    followNotification({ id: 1 }),
    replyNotification({ id: 2 }),
    repostNotification({ id: 3 }),
  ];
}

/** The nearest ancestor of `element` (itself included) carrying `className`. */
function ancestorWithClass(element: HTMLElement, className: string): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current !== null) {
    if (current.classList.contains(className)) return current;
    current = current.parentElement;
  }
  return null;
}

/** The status or alert paragraph that holds `text`, whatever wraps the text. */
function messageHolding(text: string, role: "status" | "alert"): HTMLElement {
  const holder = screen.getByText(text).closest<HTMLElement>(`[role="${role}"]`);
  if (holder === null) throw new Error(`"${text}" is not inside a ${role}`);
  return holder;
}

/** The text a reader gets from `element`, ignoring an icon's empty SVG. */
function textOf(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * A signed-in visitor on `/notifications`. Every endpoint the page can reach is
 * answered (msw errors on an unhandled request); `listHandler` replaces the
 * list read for the loading and error cases.
 */
function renderNotifications(
  notifications: NotificationOut[],
  listHandler = notificationsStub(notifications).handler,
): ClearStub {
  const clear = clearStub();
  server.use(
    listHandler,
    clear.handler,
    actorProfilesStub().handler,
    ...preferenceStub(true).handlers,
    profileFound(),
  );

  renderWithAuth(<NotificationsPage />, {
    authService: new FakeAuthService({ session: testSession() }),
    route: "/notifications",
  });

  return clear;
}

/** The clear control naming the default actor, once that actor has resolved. */
async function resolvedClearButtons(): Promise<HTMLElement[]> {
  const name = `Clear this notification from ${usernameForId(ACTOR_USER_ID)}`;
  await waitFor(() => {
    expect(screen.getAllByRole("button", { name })).toHaveLength(3);
  });
  return screen.getAllByRole("button", { name });
}

describe("the notification list (criterion 1)", () => {
  it("renders inside one Card, one li per entry", async () => {
    renderNotifications(threeNotifications());

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);

    const list = screen.getByRole("list");
    const card = ancestorWithClass(list, cardStyles.card);
    expect(card, "the list sits in a Card").not.toBeNull();

    for (const item of items) {
      expect(
        ancestorWithClass(item, cardStyles.card),
        "every row is in the same card, not a card per row",
      ).toBe(card);
      expect(item.parentElement).toBe(list);
    }
    expect(within(card as HTMLElement).getAllByRole("listitem")).toHaveLength(3);
  });

  it("does not wrap any single row in a card of its own", async () => {
    renderNotifications(threeNotifications());

    const items = await screen.findAllByRole("listitem");
    for (const item of items) {
      expect(item.querySelector(`.${cardStyles.card}`)).toBeNull();
      expect(item).not.toHaveClass(cardStyles.card);
    }
  });
});

describe("the Clear control (criterion 2)", () => {
  it("renders as a ghost sm Button with an aria-hidden icon and the same accessible name", async () => {
    renderNotifications(threeNotifications());

    const buttons = await resolvedClearButtons();

    for (const button of buttons) {
      expect(button).toHaveClass(buttonStyles.button, buttonStyles.ghost, buttonStyles.sm);
      expect(button).not.toHaveClass(buttonStyles.primary);
      expect(button).not.toHaveClass(buttonStyles.secondary);
      expect(button).not.toHaveClass(buttonStyles.md);
      expect(
        button.querySelector('svg[aria-hidden="true"]'),
        "an aria-hidden x icon inside Clear",
      ).not.toBeNull();
    }
  });
});

describe("the list's states (criterion 3)", () => {
  it("says it is loading through a neutral StatusLine", async () => {
    renderNotifications(
      [],
      http.get(NOTIFICATIONS_PATH, async () => {
        await delay("infinite");
        return HttpResponse.json([]);
      }),
    );

    await screen.findByText(LOADING);
    const status = messageHolding(LOADING, "status");
    expect(status).toHaveClass(messageStyles.message, messageStyles.neutral);
    expect(textOf(status)).toBe(LOADING);
  });

  it("reports a failed load through InlineAlert, with the same words", async () => {
    renderNotifications(
      [],
      http.get(NOTIFICATIONS_PATH, () =>
        HttpResponse.json({ detail: "Internal Server Error" }, { status: 500 }),
      ),
    );

    await screen.findByText(LOAD_FAILED);
    const alert = messageHolding(LOAD_FAILED, "alert");
    expect(alert).toHaveClass(messageStyles.message, messageStyles.danger);
    expect(textOf(alert)).toBe(LOAD_FAILED);
  });

  it("says there is nothing here through EmptyState, with the same words", async () => {
    renderNotifications([]);

    const message = await screen.findByText(EMPTY);
    expect(message).toHaveClass(emptyStyles.message);
    expect(ancestorWithClass(message, emptyStyles.empty)).not.toBeNull();
    expect(textOf(message)).toBe(EMPTY);
  });

  it("reports a failed clear through InlineAlert, with the same words", async () => {
    const user = userEvent.setup();
    const clear = renderNotifications(threeNotifications());
    const [first] = await resolvedClearButtons();
    clear.fail();

    await user.click(first);

    await screen.findByText(CLEAR_FAILED);
    const alert = messageHolding(CLEAR_FAILED, "alert");
    expect(alert).toHaveClass(messageStyles.message, messageStyles.danger);
    expect(textOf(alert)).toBe(CLEAR_FAILED);
  });
});

describe("the email preference (criterion 4)", () => {
  it("sits in its own Card, apart from the list's", async () => {
    renderNotifications(threeNotifications());

    await screen.findAllByRole("listitem");
    const checkbox = await screen.findByRole("checkbox", { name: EMAIL_LABEL });

    const preferenceCard = ancestorWithClass(checkbox, cardStyles.card);
    expect(preferenceCard, "the checkbox sits in a Card").not.toBeNull();

    const listCard = ancestorWithClass(screen.getByRole("list"), cardStyles.card);
    expect(listCard, "the list sits in a Card").not.toBeNull();
    expect(preferenceCard).not.toBe(listCard);
    expect(within(preferenceCard as HTMLElement).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("keeps the checkbox a native input with the same label", async () => {
    renderNotifications([]);

    const checkbox = await screen.findByRole("checkbox", { name: EMAIL_LABEL });
    expect(checkbox).toBeInstanceOf(HTMLInputElement);
    expect(checkbox).toHaveAttribute("type", "checkbox");
    expect(checkbox).not.toHaveAttribute("role");
    expect(screen.getByLabelText(EMAIL_LABEL)).toBe(checkbox);
  });
});
