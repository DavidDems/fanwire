/** Focus after the Account settings route is replaced by deactivated state. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TEST_PASSWORD } from "../../test/auth";
import { deactivatedShown, renderSettingsApp } from "../../test/account";

describe("after Deactivate account", () => {
  it("moves focus to the deactivated banner", async () => {
    const user = userEvent.setup();
    renderSettingsApp();
    await user.click(
      await screen.findByRole("button", { name: "Deactivate account" }),
    );
    const confirm = await screen.findByRole("alertdialog", { name: /deactivate/i });
    await user.type(within(confirm).getByLabelText(/password/i), TEST_PASSWORD);

    await user.click(within(confirm).getByRole("button", { name: /^deactivate$/i }));

    const banner = await deactivatedShown();
    await waitFor(() => expect(banner).toHaveFocus());
    expect(banner).toHaveAttribute("tabindex", "-1");
  });

  it("a page opened deactivated does not move focus to the banner", async () => {
    renderSettingsApp("deactivated");

    const banner = await deactivatedShown();

    expect(banner).not.toHaveFocus();
  });
});
