/**
 * Where focus goes after Deactivate account (`FRONTEND-012`, found in the
 * browser): the own-profile view is replaced as the app moves to the
 * deactivated state, so focus would fall to the page. It goes to the banner
 * that says what happened, which takes focus from script without becoming a
 * tab stop; a page that merely opens deactivated leaves focus alone.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { accountServer, deactivatedShown } from "../../test/account";
import { OWN_USER_ID, renderAppAt } from "../../test/app-route";

describe("after Deactivate account", () => {
  it("focus moves to the deactivated banner", async () => {
    const user = userEvent.setup();
    const account = accountServer("active");
    renderAppAt(`/profile/${OWN_USER_ID}`, "member", account.handlers);
    await user.click(
      await screen.findByRole("button", { name: "Deactivate account" }),
    );
    const confirm = await screen.findByRole("alertdialog", {
      name: /deactivate/i,
    });

    await user.click(
      within(confirm).getByRole("button", { name: /^deactivate$/i }),
    );

    const banner = await deactivatedShown();
    await waitFor(() => expect(banner).toHaveFocus());
    expect(banner).toHaveAttribute("tabindex", "-1");
  });

  it("a page opened deactivated does not move focus to it", async () => {
    renderAppAt("/", "deactivated", accountServer("deactivated").handlers);

    const banner = await deactivatedShown();

    expect(banner).not.toHaveFocus();
  });
});
