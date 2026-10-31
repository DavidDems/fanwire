/**
 * FRONTEND-006 acceptance criteria 5 and 6 — the email-notification preference.
 *
 * 5. The control reflects `GET /notifications/preference` on load and submits
 *    `PUT /notifications/preference` on change.
 * 6. A failed update restores the previous toggle position **and** shows an
 *    error the user can see.
 *
 * `email_notifications_enabled` is the only flag there is: in-app notifications
 * cannot be switched off by business rule ([[0x05-notifications]]), so there is
 * no second control here and no test asking for one.
 *
 * **NOTIFICATIONS-002: the control says when email is not available.** The
 * response's `email_available` decides. False: the box is disabled, still shows
 * the stored position, and a caption explains why. True: the box behaves as a
 * plain preference and says nothing. Most of this file runs in the available
 * state, which is the fixture's default.
 *
 * **Why the control is found by its label, not by `getByRole("checkbox")`.**
 * Whether it is a native checkbox or a `role="switch"` is the implementation's
 * call; that it is labelled, keyboard-reachable and readable by
 * `toBeChecked()` is not. `getByLabelText` accepts either and rejects an
 * unlabelled one, which is the part that matters.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http, type RequestHandler } from "msw";
import { describe, expect, it } from "vitest";

import { FakeAuthService, profileFound, renderWithAuth, testSession } from "../../test/auth";
import fieldStyles from "../../components/FormField.module.css";
import {
  actorProfilesStub,
  clearStub,
  notificationsStub,
  preferenceStub,
  type PreferenceStub,
} from "../../test/notifications";
import { server } from "../../test/server";
import { NotificationsPage } from "./NotificationsPage";

/** Permissive on wording, strict on there being a label at all. */
const EMAIL_CONTROL = /email/i;

/** The wording the human accepted by merging the spec. Exact on purpose. */
const CAPTION = "Email notifications are not available right now. You will still see them here.";

const PREFERENCE_PATH = /\/notifications\/preference$/;

/**
 * The page with an empty notification list, so nothing in these tests depends on
 * how an entry renders. The list, actor and clear handlers are installed anyway:
 * msw runs with `onUnhandledRequest: "error"`.
 */
function renderPreference(enabled: boolean, available = true): PreferenceStub {
  const preference = preferenceStub(enabled, available);
  renderPage(preference.handlers);
  return preference;
}

function renderPage(preferenceHandlers: RequestHandler[]): void {
  server.use(
    ...preferenceHandlers,
    notificationsStub([]).handler,
    actorProfilesStub().handler,
    clearStub().handler,
    profileFound(),
  );

  renderWithAuth(<NotificationsPage />, {
    authService: new FakeAuthService({ session: testSession() }),
    route: "/notifications",
  });
}

/** Long enough for a request the control wrongly sent to have reached the stub. */
async function letAnyRequestArrive(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function emailControl(): HTMLElement {
  return screen.getByLabelText(EMAIL_CONTROL);
}

describe("the email-preference control on load", () => {
  it("is on when GET /notifications/preference says email is enabled", async () => {
    const preference = renderPreference(true);

    expect(await screen.findByLabelText(EMAIL_CONTROL)).toBeChecked();
    expect(preference.gets, "one read, from the server, not a hardcoded default").toHaveLength(1);
  });

  it("is off when GET /notifications/preference says email is disabled", async () => {
    // The pair matters more than either half: a control hardcoded to its own
    // default passes whichever single case happens to agree with it.
    renderPreference(false);

    expect(await screen.findByLabelText(EMAIL_CONTROL)).not.toBeChecked();
  });
});

describe("changing the email preference", () => {
  it("submits PUT /notifications/preference with the new value", async () => {
    const user = userEvent.setup();
    const preference = renderPreference(true);

    await waitFor(() => {
      expect(emailControl()).toBeChecked();
    });
    await user.click(emailControl());

    await waitFor(() => {
      expect(preference.puts).toEqual([{ email_notifications_enabled: false }]);
    });
    // Waited for, not asserted outright: `puts` is pushed when the request
    // *arrives*, so the response has not been handled yet at that moment. This
    // criterion is about the value being submitted and the control agreeing with
    // it afterwards — whether the control moves before the server answers or
    // after is the implementation's call, and criterion 6 is the one that pins
    // what happens when the server says no.
    await waitFor(() => {
      expect(emailControl()).not.toBeChecked();
    });
  });

  it("submits the other direction too", async () => {
    // Not a duplicate: a control that sent a constant `false` — or the value it
    // was already showing — passes the test above and fails this one.
    const user = userEvent.setup();
    const preference = renderPreference(false);

    await waitFor(() => {
      expect(emailControl()).not.toBeChecked();
    });
    await user.click(emailControl());

    await waitFor(() => {
      expect(preference.puts).toEqual([{ email_notifications_enabled: true }]);
    });
    await waitFor(() => {
      expect(emailControl()).toBeChecked();
    });
  });

  it("is reachable and operable from the keyboard", async () => {
    // Every control here is keyboard-reachable — the accessibility baseline the
    // repo's query rules exist to keep testable. A div with an onClick renders
    // and clicks and fails exactly this.
    const user = userEvent.setup();
    const preference = renderPreference(true);

    await waitFor(() => {
      expect(emailControl()).toBeChecked();
    });
    emailControl().focus();
    expect(emailControl()).toHaveFocus();
    await user.keyboard(" ");

    await waitFor(() => {
      expect(preference.puts).toEqual([{ email_notifications_enabled: false }]);
    });
  });
});

describe("a preference update that fails", () => {
  it("restores the previous position and shows an error the user can see", async () => {
    const user = userEvent.setup();
    const preference = renderPreference(true);
    preference.fail();

    await waitFor(() => {
      expect(emailControl()).toBeChecked();
    });
    await user.click(emailControl());

    // The write was genuinely attempted: without this the test would also pass
    // against a control that does nothing at all when clicked.
    await waitFor(() => {
      expect(preference.puts).toEqual([{ email_notifications_enabled: false }]);
    });

    const failure = await screen.findByRole("alert");
    expect(failure.textContent?.trim(), "an empty alert tells the user nothing").not.toBe("");
    await waitFor(() => {
      expect(
        emailControl(),
        "a control left in the position the server rejected is a lie about stored state",
      ).toBeChecked();
    });
  });

  it("restores the previous position after a failed enable, too", async () => {
    const user = userEvent.setup();
    const preference = renderPreference(false);
    preference.fail();

    await waitFor(() => {
      expect(emailControl()).not.toBeChecked();
    });
    await user.click(emailControl());

    await screen.findByRole("alert");
    await waitFor(() => {
      expect(emailControl()).not.toBeChecked();
    });
  });
});

describe("the control while email is available", () => {
  it("is enabled, with no caption and no description", async () => {
    renderPreference(true, true);

    const control = await screen.findByLabelText(EMAIL_CONTROL);
    expect(control).toBeEnabled();
    expect(control).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(CAPTION)).toBeNull();
  });

  it("stays enabled, with no caption, while a PUT is in flight", async () => {
    const user = userEvent.setup();
    const preference = renderPreference(true, true);
    const release = preference.hold();

    await waitFor(() => {
      expect(emailControl()).toBeChecked();
    });
    await user.click(emailControl());
    await waitFor(() => {
      expect(preference.puts).toEqual([{ email_notifications_enabled: false }]);
    });

    // The optimistic position shows the patch landed. An optimistic patch that
    // dropped `email_available` would read as "not available" right here.
    await waitFor(() => {
      expect(emailControl()).not.toBeChecked();
    });
    expect(emailControl()).toBeEnabled();
    expect(screen.queryByText(CAPTION)).toBeNull();

    release();
    await waitFor(() => {
      expect(emailControl()).not.toBeChecked();
    });
    expect(emailControl()).toBeEnabled();
  });

  it("restores both fields after a failed PUT", async () => {
    const user = userEvent.setup();
    const preference = renderPreference(true, true);
    preference.fail();

    await waitFor(() => {
      expect(emailControl()).toBeChecked();
    });
    await user.click(emailControl());

    await screen.findByRole("alert");
    await waitFor(() => {
      expect(emailControl()).toBeChecked();
    });
    expect(emailControl()).toBeEnabled();
    expect(screen.queryByText(CAPTION)).toBeNull();
  });
});

describe("the control while email is not available", () => {
  it.each([
    ["on", true],
    ["off", false],
  ])("is disabled and shows a stored position of %s", async (_label, stored) => {
    renderPreference(stored, false);

    const control = await screen.findByLabelText(EMAIL_CONTROL);
    expect(control).toBeDisabled();
    expect((control as HTMLInputElement).checked).toBe(stored);
  });

  it("captions the control through Field's hint, as its accessible description", async () => {
    renderPreference(true, false);

    const control = await screen.findByLabelText(EMAIL_CONTROL);
    const caption = screen.getByText(CAPTION);
    expect(caption).toHaveClass(fieldStyles.hint);
    expect(caption.id).toBe("email-notifications-hint");
    expect(control).toHaveAttribute("aria-describedby", caption.id);
    expect(control).toHaveAccessibleDescription(CAPTION);
  });

  it.each([
    ["on", true],
    ["off", false],
  ])(
    "sends no PUT from a stored position of %s, by box, label or keyboard",
    async (_label, stored) => {
      const user = userEvent.setup();
      const preference = renderPreference(stored, false);

      const control = await screen.findByLabelText(EMAIL_CONTROL);
      await user.click(control);
      await user.click(screen.getByText("Email me about new notifications"));
      control.focus();
      await user.keyboard(" ");
      await letAnyRequestArrive();

      expect(preference.puts).toEqual([]);
      expect((control as HTMLInputElement).checked).toBe(stored);
    },
  );
});

describe("before there is a preference to show", () => {
  it("renders no caption and no checkbox while loading", async () => {
    renderPage([
      http.get(PREFERENCE_PATH, async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    ]);

    await screen.findByText("Loading your email preference…");
    expect(screen.queryByText(CAPTION)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("renders no caption and no checkbox when the load fails", async () => {
    renderPage([
      http.get(PREFERENCE_PATH, () =>
        HttpResponse.json({ detail: "Internal Server Error" }, { status: 500 }),
      ),
    ]);

    await screen.findByText("We could not load your email preference. Please try again.");
    expect(screen.queryByText(CAPTION)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
