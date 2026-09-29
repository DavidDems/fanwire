/**
 * FRONTEND-006 acceptance criterion 2 — clearing a notification.
 *
 * "Clearing a notification removes it from the list before
 * `POST /notifications/{id}/clear` returns, and a failed clear restores it to
 * its original position."
 *
 * Clearing is a soft delete on the backend (`cleared_at`, [[0x05-notifications]]).
 * Nothing in this unit is supposed to expose that: from here it is a 204 and the
 * row is gone.
 *
 * **The middle row, not the last one.** This is the whole design of the file.
 * A rollback that re-appends the entry rather than restoring the snapshot is
 * indistinguishable from a correct one when the cleared row was last — and a
 * naive refetch-on-error produces exactly that. So every case here clears the
 * *middle* of three, where "restored" is `[11, 22, 33]` and "appended" is
 * `[11, 33, 22]`, and the assertion is on the order rather than on the count.
 *
 * **Why the request is held open.** A clear that only removed the row once the
 * response landed would still end up with the right list; holding the request is
 * what makes "before it returns" an assertion rather than a race. The failure is
 * armed while the request is held, so the optimistic state is observable before
 * the 500 arrives — `clearStub` reads its failure flag after the gate for that
 * reason.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FakeAuthService, profileFound, renderWithAuth, testSession } from "../../test/auth";
import {
  actorProfilesStub,
  clearStub,
  followNotification,
  notificationsStub,
  preferenceStub,
  replyNotification,
  repostNotification,
  type ClearStub,
  type NotificationsStub,
} from "../../test/notifications";
import { server } from "../../test/server";
import { usernameForId } from "../../test/users";
import { NotificationsPage } from "./NotificationsPage";

/**
 * Three actors, one per row, with no username that is a prefix of another — the
 * row's actor is how this file identifies which row is which, so 1 and 11 next
 * to each other would make `[1]` match the row belonging to `[11]`.
 */
const ACTORS = [11, 22, 33] as const;

/** The notification ids, in the order the list returns them. */
const IDS = [10, 20, 30] as const;

interface Scene {
  list: NotificationsStub;
  clear: ClearStub;
}

/** Three notifications, one per actor, each of a different type. */
function threeNotifications() {
  return [
    followNotification({ id: IDS[0], actor_user_id: ACTORS[0] }),
    replyNotification({ id: IDS[1], actor_user_id: ACTORS[1] }),
    repostNotification({ id: IDS[2], actor_user_id: ACTORS[2] }),
  ];
}

function renderNotifications(): Scene {
  const list = notificationsStub(threeNotifications());
  const clear = clearStub();

  server.use(
    list.handler,
    clear.handler,
    actorProfilesStub().handler,
    ...preferenceStub(true).handlers,
    profileFound(),
  );

  renderWithAuth(<NotificationsPage />, {
    authService: new FakeAuthService({ session: testSession() }),
    route: "/notifications",
  });

  return { list, clear };
}

/**
 * The actors the list is showing, top to bottom.
 *
 * Derived from `usernameForId` rather than from the username's shape, so this
 * file makes no assumption about what `src/test/users.ts` calls user 22.
 */
function renderedActors(): number[] {
  return screen.getAllByRole("listitem").map((row) => {
    const text = row.textContent ?? "";
    const actor = ACTORS.find((id) => text.includes(usernameForId(id)));
    if (actor === undefined) throw new Error(`no known actor in ${JSON.stringify(text)}`);
    return actor;
  });
}

/** The clear control on the row at `index`. Named per row, found within it. */
function clearControlAt(index: number): HTMLElement {
  return within(screen.getAllByRole("listitem")[index]).getByRole("button", { name: /clear/i });
}

/** Wait until every row has resolved its actor, so ordering is readable at all. */
async function listSettled(): Promise<void> {
  await screen.findAllByRole("listitem");
  await waitFor(() => {
    expect(renderedActors()).toEqual([...ACTORS]);
  });
}

describe("clearing a notification", () => {
  it("removes the entry before POST /notifications/{id}/clear returns", async () => {
    const user = userEvent.setup();
    const { list, clear } = renderNotifications();
    await listSettled();

    const release = clear.hold();
    await user.click(clearControlAt(1));

    // Gone while the request is still in flight — that is what "optimistic"
    // means here, and a page that waited for the 204 would leave this timing out.
    await waitFor(() => {
      expect(renderedActors()).toEqual([ACTORS[0], ACTORS[2]]);
    });
    expect(clear.calls, "the row's own id, not the first one's").toEqual([IDS[1]]);

    // The server's answer, installed only now: the refetch a settled mutation
    // makes has to find the list the clear produced, not the one before it.
    const [first, , third] = threeNotifications();
    list.answerWith([first, third]);
    release();

    await waitFor(() => {
      expect(renderedActors()).toEqual([ACTORS[0], ACTORS[2]]);
    });
  });

  it("restores a failed clear to its original position, not to the end of the list", async () => {
    const user = userEvent.setup();
    const { clear } = renderNotifications();
    await listSettled();

    const release = clear.hold();
    await user.click(clearControlAt(1));
    await waitFor(() => {
      expect(renderedActors()).toEqual([ACTORS[0], ACTORS[2]]);
    });

    // Armed while the request is held, so the optimistic removal above was
    // genuinely observable before the failure landed.
    clear.fail();
    release();

    await waitFor(() => {
      expect(
        renderedActors(),
        "a restored entry goes back where it was; re-appending it puts 22 last",
      ).toEqual([...ACTORS]);
    });
  });

  it("restores the first entry to the top after a failed clear", async () => {
    // The mirror of the case above. Restoring to position zero is the one a
    // `[...remaining, restored]` rollback gets most visibly wrong, and an
    // implementation that special-cased "put it back at the end unless it was
    // the middle one" would pass only one of these two tests.
    const user = userEvent.setup();
    const { clear } = renderNotifications();
    await listSettled();

    const release = clear.hold();
    await user.click(clearControlAt(0));
    await waitFor(() => {
      expect(renderedActors()).toEqual([ACTORS[1], ACTORS[2]]);
    });

    clear.fail();
    release();

    await waitFor(() => {
      expect(renderedActors()).toEqual([...ACTORS]);
    });
    expect(clear.calls).toEqual([IDS[0]]);
  });
});
