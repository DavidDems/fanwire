/** USERS-006: reauthenticate before the server-checked deactivation. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TEST_PASSWORD, FakeAuthService, testSession } from "../../test/auth";
import {
  deactivatedShown,
  queryDeactivatedBanner,
  renderSettingsApp,
} from "../../test/account";

async function openConfirm(auth = new FakeAuthService({ session: testSession() })) {
  const user = userEvent.setup();
  renderSettingsApp("active", auth);
  await screen.findByRole("heading", { name: "Account settings" });
  await user.click(screen.getByRole("button", { name: "Deactivate account" }));
  const dialog = await screen.findByRole("alertdialog", { name: /deactivate/i });
  const password = within(dialog).getByLabelText(/password/i);
  const deactivate = within(dialog).getByRole("button", {
    name: /^deactivate(?: account)?$/i,
  });
  return { user, dialog, password, deactivate, auth };
}

describe("deactivating an account", () => {
  it("requires a current-password value and clears it after close", async () => {
    const { user, dialog, password, deactivate } = await openConfirm();

    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(deactivate).toBeDisabled();
    await user.type(password, "wrong-on-purpose");
    expect(deactivate).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Deactivate account" }));
    const reopened = await screen.findByRole("alertdialog", { name: /deactivate/i });
    expect(within(reopened).getByLabelText(/password/i)).toHaveValue("");
  });

  it("keeps a wrong password in the dialog and sends no DELETE", async () => {
    const session = testSession();
    const auth = new FakeAuthService({ session })
      .failWith("reauthenticate", "NotAuthorizedException", "Incorrect password.");
    const { user, dialog, password, deactivate, account } = await openConfirm(auth);

    await user.type(password, TEST_PASSWORD);
    await user.click(deactivate);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/password/i);
    expect(screen.getByRole("alertdialog", { name: /deactivate/i })).toBeInTheDocument();
    expect(account.deactivations).toEqual([]);
    expect(auth.session).toBe(session);
  });

  it("asks Cognito to wait after a too-many-attempts answer", async () => {
    const auth = new FakeAuthService({ session: testSession() })
      .failWith("reauthenticate", "TooManyRequestsException", "Too many attempts.");
    const { user, dialog, password, deactivate, account } = await openConfirm(auth);

    await user.type(password, TEST_PASSWORD);
    await user.click(deactivate);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/wait and try later/i);
    expect(account.deactivations).toEqual([]);
  });

  it("reauthenticates, deactivates once and shows the deactivated state", async () => {
    const { user, password, deactivate, account, auth } = await openConfirm();
    await user.type(password, TEST_PASSWORD);

    await user.click(deactivate);

    await waitFor(() => expect(account.deactivations).toHaveLength(1));
    await deactivatedShown();
    expect(auth.callsTo("reauthenticate")).toEqual([TEST_PASSWORD]);
    expect(queryDeactivatedBanner()).toBeInTheDocument();
    expect(auth.callsTo("signOut")).toEqual([]);
  });
});
