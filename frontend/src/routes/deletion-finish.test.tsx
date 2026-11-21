/**
 * The shell's "Finishing account deletion…" line lasts only until deletion
 * reaches home: a later page is drawn as itself, not as that line.
 *
 * FRONTEND-047 moved the flag's reset out of an effect and into render
 * (react-hooks 7's `set-state-in-effect` rule); this pins what it must keep.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../test/app-route";

describe("finishing an account deletion", () => {
  it("ends at home, and the next page is shown, not the finishing line", async () => {
    const user = userEvent.setup();
    const app = renderAppAt("/settings", "member", [
      http.delete(
        "*/users/me/data",
        () => new HttpResponse(null, { status: 204 }),
      ),
    ]);

    await user.click(
      await screen.findByRole("button", { name: "Delete my data" }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete all your data?",
    });
    await user.type(within(dialog).getByLabelText(/password/i), "my-password");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete my data" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Your account and data have been deleted.",
      );
    });
    expect(app.router.state.location.pathname).toBe("/");

    await act(() => app.router.navigate("/search"));

    expect(app.router.state.location.pathname).toBe("/search");
    expect(screen.queryByText("Finishing account deletion…")).toBeNull();
  });
});
