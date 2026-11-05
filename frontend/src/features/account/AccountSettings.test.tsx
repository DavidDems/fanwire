/** USERS-006: the account settings page's sections and account verification. */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderSettingsApp } from "../../test/account";
import { FakeAuthService, testSession } from "../../test/auth";
import { server } from "../../test/server";

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
    expect(before(verify, notifications)).toBe(true);
    expect(before(notifications, deactivate)).toBe(true);
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
});
