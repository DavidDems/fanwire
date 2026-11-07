/** USERS-008: permanently delete the signed-in member's data after reauthentication. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/app-route";
import { renderSettingsApp } from "../../test/account";
import { FakeAuthService, testSession } from "../../test/auth";
import { server } from "../../test/server";

describe("Delete my data", () => {
  it("is the last account-settings section and explains what deletion means", async () => {
    renderSettingsApp("active", new FakeAuthService({ session: testSession() }));

    const button = await screen.findByRole("button", { name: "Delete my data" });
    await userEvent.setup().click(button);

    const dialog = screen.getByRole("alertdialog", { name: "Delete all your data?" });
    const copy = dialog.textContent ?? "";
    for (const term of [
      "account",
      "profile",
      "posts",
      "replies",
      "likes",
      "reposts",
      "follows",
      "notifications",
      "images",
      "Replies other people wrote stay",
      "backup copies expire within 7 days",
      "cannot be undone",
      "recovery is not possible",
    ]) {
      expect(copy.toLowerCase()).toContain(term.toLowerCase());
    }
    expect(within(dialog).getByLabelText(/password/i)).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("keeps the dialog open after a wrong password and makes no deletion request", async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService({ session: testSession() }).failWith(
      "reauthenticate",
      "NotAuthorizedException",
    );
    const requests: string[] = [];
    server.use(
      http.delete("*/users/me/data", ({ request }) => {
        requests.push(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderSettingsApp("active", auth);

    await user.click(await screen.findByRole("button", { name: "Delete my data" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete all your data?" });
    const password = within(dialog).getByLabelText(/password/i);
    const confirm = within(dialog).getByRole("button", { name: "Delete my data" });
    expect(confirm).toBeDisabled();
    await user.type(password, "wrong-password");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(auth.callsTo("reauthenticate")).toEqual(["wrong-password"]);
    expect(requests).toEqual([]);
    expect(screen.getByRole("alertdialog", { name: "Delete all your data?" })).toBeInTheDocument();
  });

  it("reauthenticates, deletes once, signs out, clears the app, and announces success", async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    const app = renderAppAt("/settings", "member", [
      http.delete("*/users/me/data", ({ request }) => {
        requests.push(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    ]);
    const auth = app.authService as FakeAuthService;
    app.queryClient.setQueryData(["USERS-008-private-cache-sentinel"], "private");

    await user.click(await screen.findByRole("button", { name: "Delete my data" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete all your data?" });
    await user.type(within(dialog).getByLabelText(/password/i), "my-password");
    const releaseReauthentication = auth.pause();
    try {
      await user.click(within(dialog).getByRole("button", { name: "Delete my data" }));
      await waitFor(() => {
        expect(auth.callsTo("reauthenticate")).toEqual(["my-password"]);
      });
      expect(requests).toEqual([]);
      expect(auth.callsTo("signOut")).toEqual([]);
    } finally {
      releaseReauthentication();
    }

    await waitFor(() => {
      expect(auth.callsTo("reauthenticate")).toEqual(["my-password"]);
      expect(requests).toHaveLength(1);
      expect(auth.callsTo("signOut")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Your account and data have been deleted.",
      );
    });
    expect(app.router.state.location.pathname).toBe("/");
    expect(
      app.queryClient.getQueryData(["USERS-008-private-cache-sentinel"]),
    ).toBeUndefined();
  });

  it("keeps the dialog open and says retrying loses nothing after an API failure", async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService({ session: testSession() });
    server.use(
      http.delete("*/users/me/data", () =>
        HttpResponse.json({ detail: "Internal Server Error" }, { status: 500 }),
      ),
    );
    renderSettingsApp("active", auth);

    await user.click(await screen.findByRole("button", { name: "Delete my data" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete all your data?" });
    await user.type(within(dialog).getByLabelText(/password/i), "my-password");
    await user.click(within(dialog).getByRole("button", { name: "Delete my data" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/nothing is lost/i);
    expect(auth.callsTo("signOut")).toEqual([]);
  });
});
