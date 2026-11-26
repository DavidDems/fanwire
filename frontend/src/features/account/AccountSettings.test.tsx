/** USERS-006: the account settings page's sections and account verification. */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ForgotPasswordPage } from "../../auth/ForgotPasswordPage";
import buttonStyles from "../../components/ui/Button.module.css";
import { AppLayout } from "../../routes/AppLayout";
import { accountServer, renderSettingsApp } from "../../test/account";
import { FakeAuthService, renderWithAuth, testSession } from "../../test/auth";
import { server } from "../../test/server";
import { AccountSettings } from "./AccountSettings";

function before(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

async function initialRefreshCount(auth: FakeAuthService): Promise<number> {
  await waitFor(() => {
    expect(auth.callsTo("refreshSession").length).toBeGreaterThan(0);
  });
  return auth.callsTo("refreshSession").length;
}

describe("Account settings", () => {
  it("shows verification, notifications and deactivation in that order", async () => {
    renderSettingsApp("active", new FakeAuthService({ session: testSession() }));

    // Let the shell's profile request finish before a missing new control can
    // fail this test and reset its MSW handlers during teardown.
    await screen.findByRole("button", { name: "Account menu" });

    expect(
      await screen.findByRole("heading", { name: "Account settings" }),
    ).toBeInTheDocument();
    const verify = screen.getByRole("button", { name: "Verified" });
    const notifications = screen.getByRole("checkbox", {
      name: "Notifications",
    });
    const deactivate = screen.getByRole("button", {
      name: "Deactivate account",
    });
    const deleteData = screen.getByRole("button", { name: "Delete my data" });
    expect(before(verify, notifications)).toBe(true);
    expect(before(notifications, deactivate)).toBe(true);
    expect(before(deactivate, deleteData)).toBe(true);
  });

  it("offers email verification to an unverified account and refreshes after confirmation", async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService({
      session: testSession(),
      emailVerified: false,
    });
    renderSettingsApp("active", auth);
    const refreshCount = await initialRefreshCount(auth);

    await user.click(
      await screen.findByRole("button", { name: "Verify this account" }),
    );
    expect(auth.callsTo("requestEmailVerification")).toEqual([undefined]);

    const code = await screen.findByRole("textbox", {
      name: /verification code/i,
    });
    await user.click(screen.getByRole("button", { name: "Resend code" }));
    expect(auth.callsTo("requestEmailVerification")).toHaveLength(2);
    await user.type(code, "482913");
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(auth.callsTo("confirmEmailVerification")).toEqual(["482913"]);
      expect(auth.callsTo("refreshSession")).toHaveLength(refreshCount + 1);
    });
    const verified = await screen.findByRole("button", { name: "Verified" });
    expect(verified).toHaveAccessibleName("Verified");
    expect(verified).toBeDisabled();
    expect(verified.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps verification retryable when requesting a code fails", async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService({
      session: testSession(),
      emailVerified: false,
    }).failWith("requestEmailVerification", "LimitExceededException");
    renderSettingsApp("active", auth);
    await initialRefreshCount(auth);

    await user.click(
      await screen.findByRole("button", { name: "Verify this account" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not send a verification code/i,
    );
    expect(screen.queryByRole("textbox", { name: /verification code/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Verify this account" }),
    ).toBeEnabled();
    expect(auth.callsTo("requestEmailVerification")).toEqual([undefined]);
  });

  it("shows a mismatched verification code on its field", async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService({
      session: testSession(),
      emailVerified: false,
    }).failWith("confirmEmailVerification", "CodeMismatchException");
    renderSettingsApp("active", auth);
    const refreshCount = await initialRefreshCount(auth);

    await user.click(
      await screen.findByRole("button", { name: "Verify this account" }),
    );
    await user.type(
      await screen.findByRole("textbox", { name: /verification code/i }),
      "000000",
    );
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/code/i);
    expect(auth.callsTo("refreshSession")).toHaveLength(refreshCount);
  });

  it("shows an expired verification code as a field error", async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService({
      session: testSession(),
      emailVerified: false,
    }).failWith("confirmEmailVerification", "ExpiredCodeException");
    renderSettingsApp("active", auth);
    const refreshCount = await initialRefreshCount(auth);

    await user.click(
      await screen.findByRole("button", { name: "Verify this account" }),
    );
    const code = await screen.findByRole("textbox", {
      name: /verification code/i,
    });
    await user.type(code, "482913");
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    expect(auth.callsTo("refreshSession")).toHaveLength(refreshCount);
  });

  it("keeps the enabled notifications policy checked and disabled", async () => {
    renderSettingsApp("active", new FakeAuthService({ session: testSession() }));

    const checkbox = await screen.findByRole("checkbox", {
      name: "Notifications",
    });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(screen.getByText("On for every account for now")).toBeInTheDocument();
    // The shell's own GET /users/me starts after the checkbox renders: wait for
    // it to land (the Account menu), or the window below can catch it.
    await screen.findByRole("button", { name: "Account menu" });

    const requests: string[] = [];
    const listener = ({ request }: { request: Request }) => {
      requests.push(request.url);
    };
    server.events.on("request:start", listener);
    try {
      fireEvent.click(checkbox);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      server.events.removeListener("request:start", listener);
    }
    expect(requests).toEqual([]);
  });

  it("words a failed verification check with the typographic apostrophe", async () => {
    const auth = new FakeAuthService({ session: testSession() });
    vi.spyOn(auth, "emailVerified").mockRejectedValue(
      new Error("verification check failed"),
    );
    renderSettingsApp("active", auth);

    expect(
      await screen.findByText(
        "We could not check this account’s verification status.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Account settings — Account details (AUTH-001)", () => {
  it("begins with an Account details section, before Verify this account", async () => {
    renderSettingsApp("active", new FakeAuthService({ session: testSession() }));
    await screen.findByRole("button", { name: "Account menu" });

    const main = screen.getByRole("main");
    await within(main).findByRole("heading", { name: "Verify this account" });
    const headings = within(main).getAllByRole("heading", { level: 2 }).map(
      (heading) => heading.textContent,
    );
    expect(headings[0]).toBe("Account details");
    expect(headings.indexOf("Account details")).toBeLessThan(
      headings.indexOf("Verify this account"),
    );
    const section = screen.getByRole("region", { name: "Account details" });
    expect(section.tagName).toBe("SECTION");
  });

  it("shows the signed-in session's email on an Email row", async () => {
    const email = "someone.else@example.test";
    renderSettingsApp("active", new FakeAuthService({ session: testSession({ email }) }));
    await screen.findByRole("button", { name: "Account menu" });

    const section = await screen.findByRole("region", { name: "Account details" });
    expect(within(section).getByText("Email")).toBeInTheDocument();
    expect(within(section).getByText(email)).toBeInTheDocument();
  });

  it("has a Password row with a Reset password control to /forgot-password and no password value", async () => {
    renderSettingsApp("active", new FakeAuthService({ session: testSession() }));
    await screen.findByRole("button", { name: "Account menu" });

    const section = await screen.findByRole("region", { name: "Account details" });
    expect(within(section).getByText("Password")).toBeInTheDocument();
    const reset = within(section).getByRole("link", { name: "Reset password" });
    expect(reset).toHaveAttribute("href", "/forgot-password");
    // The control is a 44 px Button-styled link, never a bare text link.
    expect(reset).toHaveClass(buttonStyles.button);
    expect(reset).toHaveClass(buttonStyles.md);
    // No password, masked or otherwise, and no password input.
    expect(section.textContent ?? "").not.toMatch(/[•*●]{3,}/);
    expect(section.querySelector("input")).toBeNull();
  });

  it("sends Reset password to the reset page, which signs the user out", async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService({ session: testSession() });
    server.use(...accountServer("active").handlers);
    renderWithAuth(
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route path="settings" element={<AccountSettings />} />
        </Route>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Routes>,
      { authService: auth, route: "/settings" },
    );
    await screen.findByRole("button", { name: "Account menu" });

    await user.click(await screen.findByRole("link", { name: "Reset password" }));

    expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument();
    expect(auth.callsTo("signOut")).toHaveLength(1);
    expect(auth.session).toBeNull();
  });
});
