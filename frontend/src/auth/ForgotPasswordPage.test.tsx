/**
 * FRONTEND-002 acceptance criteria 8 and 9 — resetting a forgotten password.
 *
 * Cognito splits this into two calls — `forgotPassword` sends the code,
 * `confirmForgotPassword` spends it — and they are two steps of one page rather
 * than two routes. The code is only valid for the address that requested it, so
 * a second route the user could arrive at with a different email in hand is a
 * dead end nobody can debug.
 *
 * The page therefore keeps the email it sent the code to, and step two does not
 * ask for it again.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { FakeAuthService, TEST_EMAIL, TEST_PASSWORD, renderWithAuth } from "../test/auth";
import { ForgotPasswordPage } from "./ForgotPasswordPage";

const CODE = "654321";
const NEW_PASSWORD = `${TEST_PASSWORD}-new`;

function renderForgotPassword(authService: FakeAuthService) {
  return renderWithAuth(
    <Routes>
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/sign-in" element={<p>sign-in stub</p>} />
    </Routes>,
    { authService, route: "/forgot-password" },
  );
}

function expectFieldError(field: HTMLElement): void {
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription();
}

async function requestCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^email$/i), TEST_EMAIL);
  await user.click(screen.getByRole("button", { name: /send code/i }));
}

async function submitNewPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/confirmation code/i), CODE);
  await user.type(screen.getByLabelText(/new password/i), NEW_PASSWORD);
  await user.click(screen.getByRole("button", { name: /reset password/i }));
}

describe("ForgotPasswordPage — asking for a code", () => {
  it("is the forgot-password view, with a labelled email field", () => {
    renderForgotPassword(new FakeAuthService());

    expect(screen.getByRole("heading", { name: /forgot\s*-?\s*password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
  });

  it("does not ask for a code before one has been sent", () => {
    renderForgotPassword(new FakeAuthService());

    expect(screen.queryByLabelText(/confirmation code/i)).toBeNull();
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
  });

  it("asks the service for a code for that address", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService();
    renderForgotPassword(service);

    await requestCode(user);

    expect(service.callsTo("forgotPassword")).toEqual([TEST_EMAIL]);
  });

  it("reveals the code and new-password fields once the code is on its way", async () => {
    const user = userEvent.setup();
    renderForgotPassword(new FakeAuthService());

    await requestCode(user);

    expect(await screen.findByLabelText(/confirmation code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
  });

  it("puts an unknown account on the email field", async () => {
    const user = userEvent.setup();
    renderForgotPassword(new FakeAuthService().failWith("forgotPassword", "UserNotFoundException"));

    await requestCode(user);

    expectFieldError(await screen.findByLabelText(/^email$/i));
    expect(screen.queryByLabelText(/confirmation code/i)).toBeNull();
  });
});

describe("ForgotPasswordPage — spending the code", () => {
  it("resets through the injected service, for the address the code was sent to", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService();
    renderForgotPassword(service);

    await requestCode(user);
    await submitNewPassword(user);

    expect(await screen.findByText("sign-in stub")).toBeInTheDocument();
    expect(service.callsTo("confirmForgotPassword")).toEqual([
      { email: TEST_EMAIL, code: CODE, newPassword: NEW_PASSWORD },
    ]);
  });

  it("puts a wrong code on the code field", async () => {
    const user = userEvent.setup();
    renderForgotPassword(
      new FakeAuthService().failWith("confirmForgotPassword", "CodeMismatchException"),
    );

    await requestCode(user);
    await submitNewPassword(user);

    expectFieldError(await screen.findByLabelText(/confirmation code/i));
    expect(screen.getByLabelText(/new password/i)).not.toHaveAttribute("aria-invalid", "true");
  });

  it("puts a rejected password on the new-password field", async () => {
    const user = userEvent.setup();
    renderForgotPassword(
      new FakeAuthService().failWith("confirmForgotPassword", "InvalidPasswordException"),
    );

    await requestCode(user);
    await submitNewPassword(user);

    expectFieldError(await screen.findByLabelText(/new password/i));
    expect(screen.getByLabelText(/confirmation code/i)).not.toHaveAttribute("aria-invalid", "true");
  });

  it("stays on the page when the reset fails", async () => {
    const user = userEvent.setup();
    renderForgotPassword(
      new FakeAuthService().failWith("confirmForgotPassword", "ExpiredCodeException"),
    );

    await requestCode(user);
    await submitNewPassword(user);

    expectFieldError(await screen.findByLabelText(/confirmation code/i));
    expect(screen.queryByText("sign-in stub")).toBeNull();
  });
});
