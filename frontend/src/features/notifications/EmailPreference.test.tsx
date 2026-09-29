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
 * **The control is not disabled and says nothing about SES.** Email delivery is
 * a deliberate no-op in every environment today — `SesEmailSender` skips sending
 * while `NOTIFICATION_FROM_ADDRESS` is unset, and no identity is verified yet —
 * but that is a deployment state, not a feature flag. The toggle stores a real
 * preference, so the last test here pins that it is usable and unexplained.
 *
 * **Why the control is found by its label, not by `getByRole("checkbox")`.**
 * Whether it is a native checkbox or a `role="switch"` is the implementation's
 * call; that it is labelled, keyboard-reachable and readable by
 * `toBeChecked()` is not. `getByLabelText` accepts either and rejects an
 * unlabelled one, which is the part that matters.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FakeAuthService, profileFound, renderWithAuth, testSession } from "../../test/auth";
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

/**
 * The page with an empty notification list, so nothing in these tests depends on
 * how an entry renders. The list, actor and clear handlers are installed anyway:
 * msw runs with `onUnhandledRequest: "error"`.
 */
function renderPreference(enabled: boolean): PreferenceStub {
  const preference = preferenceStub(enabled);

  server.use(
    ...preference.handlers,
    notificationsStub([]).handler,
    actorProfilesStub().handler,
    clearStub().handler,
    profileFound(),
  );

  renderWithAuth(<NotificationsPage />, {
    authService: new FakeAuthService({ session: testSession() }),
    route: "/notifications",
  });

  return preference;
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

describe("the control itself", () => {
  it("is enabled, and explains nothing about email delivery being switched off", async () => {
    // SES has no verified identity yet and `NOTIFICATION_FROM_ADDRESS` is unset
    // everywhere, so nothing acts on this preference today. That is a deployment
    // state, and the UI is not the place it gets explained — the toggle stores a
    // real preference and behaves like one.
    renderPreference(true);

    expect(await screen.findByLabelText(EMAIL_CONTROL)).toBeEnabled();
    expect(screen.queryByText(/ses|not yet|coming soon|unavailable/i)).toBeNull();
  });
});
