/**
 * FRONTEND-002 acceptance criteria 2, 8 and 9 — the emailed confirmation code.
 *
 * This is the page that makes `resendConfirmationCode` more than a method on an
 * interface: Cognito's code expires, and without a resend the only recovery is
 * a second account.
 *
 * The email field is prefilled from the navigation state sign-up left behind,
 * and is still editable — someone who lands here from a bookmark, or who mistyped
 * on sign-up, has to be able to say who they are.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Navigate, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { FakeAuthService, TEST_EMAIL, renderWithAuth } from "../test/auth";
import { ConfirmPage } from "./ConfirmPage";

const CODE = "123456";
/** The fixed alert for any code the page has no field for (ForgotPasswordPage's wording). */
const GENERIC_FAILURE = "Something went wrong. Please try again.";
/** Distinctive provider text: it must never reach the page. */
const PROVIDER_TEXT = "Provider says: user does not exist";
/** Codes the page maps to no field, including one Cognito has never sent. */
const UNMAPPED_CODES = ["UserNotFoundException", "InternalErrorException", "MadeUpProviderException"];

/** Arriving from sign-up means arriving with `state.email`; a bookmark means without. */
function renderConfirm(authService: FakeAuthService, { withEmail = true } = {}) {
  return renderWithAuth(
    <Routes>
      <Route
        path="/"
        element={
          <Navigate to="/confirm" state={withEmail ? { email: TEST_EMAIL } : null} replace />
        }
      />
      <Route path="/confirm" element={<ConfirmPage />} />
      <Route path="/sign-in" element={<p>sign-in stub</p>} />
    </Routes>,
    { authService, route: "/" },
  );
}

function expectFieldError(field: HTMLElement): void {
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription();
}

function expectNoFieldError(field: HTMLElement): void {
  expect(field).not.toHaveAttribute("aria-invalid", "true");
}

async function submitCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/confirmation code/i), CODE);
  await user.click(screen.getByRole("button", { name: /^confirm$/i }));
}

describe("ConfirmPage", () => {
  it("is the confirmation view, with both inputs labelled", async () => {
    renderConfirm(new FakeAuthService());

    expect(await screen.findByRole("heading", { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirmation code/i)).toBeInTheDocument();
  });

  it("prefills the email sign-up handed over", async () => {
    renderConfirm(new FakeAuthService());

    expect(await screen.findByLabelText(/^email$/i)).toHaveValue(TEST_EMAIL);
  });

  it("leaves the email empty and editable when nobody handed one over", async () => {
    const user = userEvent.setup();
    renderConfirm(new FakeAuthService(), { withEmail: false });

    const email = await screen.findByLabelText(/^email$/i);
    expect(email).toHaveValue("");

    await user.type(email, TEST_EMAIL);
    expect(email).toHaveValue(TEST_EMAIL);
  });

  it("confirms through the injected service and sends the user to sign-in", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService();
    renderConfirm(service);

    await submitCode(user);

    expect(await screen.findByText("sign-in stub")).toBeInTheDocument();
    expect(service.callsTo("confirmSignUp")).toEqual([{ email: TEST_EMAIL, code: CODE }]);
  });

  it("resends the code for the address on the form, and says so", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService();
    renderConfirm(service);

    await user.click(await screen.findByRole("button", { name: /resend/i }));

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(service.callsTo("resendConfirmationCode")).toEqual([TEST_EMAIL]);
  });

  it("puts a wrong code on the code field", async () => {
    const user = userEvent.setup();
    renderConfirm(new FakeAuthService().failWith("confirmSignUp", "CodeMismatchException"));

    await submitCode(user);

    expectFieldError(await screen.findByLabelText(/confirmation code/i));
    expectNoFieldError(screen.getByLabelText(/^email$/i));
  });

  it("puts an expired code on the code field", async () => {
    const user = userEvent.setup();
    renderConfirm(new FakeAuthService().failWith("confirmSignUp", "ExpiredCodeException"));

    await submitCode(user);

    expectFieldError(await screen.findByLabelText(/confirmation code/i));
    expect(screen.queryByText("sign-in stub")).toBeNull();
  });

  it.each(UNMAPPED_CODES)(
    "shows one fixed message for %s and never the provider's own text",
    async (code) => {
      // The pool sets `preventUserExistenceErrors`, so Cognito does not send
      // `UserNotFoundException` here; if it ever did, its text would name
      // account existence, the leak the setting exists to stop. Every code the
      // page has no field for gets the same fixed alert.
      const user = userEvent.setup();
      renderConfirm(new FakeAuthService().failWith("confirmSignUp", code, PROVIDER_TEXT));

      await submitCode(user);

      expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC_FAILURE);
      expect(document.body).not.toHaveTextContent(PROVIDER_TEXT);
      expectNoFieldError(screen.getByLabelText(/^email$/i));
      expectNoFieldError(screen.getByLabelText(/confirmation code/i));
    },
  );

  it.each(["LimitExceededException", "TooManyRequestsException"])(
    "announces a throttled resend (%s) instead of silently doing nothing",
    async (code) => {
      // Not about a field — nothing the user typed is wrong — so it belongs in
      // an alert. Saying nothing is the real defect: the button appears to have
      // worked. The alert is fixed text, not the provider's.
      const user = userEvent.setup();
      renderConfirm(
        new FakeAuthService().failWith("resendConfirmationCode", code, PROVIDER_TEXT),
      );

      await user.click(await screen.findByRole("button", { name: /resend/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/too many attempts/i);
      expect(document.body).not.toHaveTextContent(PROVIDER_TEXT);
    },
  );

  it.each(UNMAPPED_CODES)(
    "shows one fixed message when a resend fails with %s, never the provider's text",
    async (code) => {
      const user = userEvent.setup();
      renderConfirm(
        new FakeAuthService().failWith("resendConfirmationCode", code, PROVIDER_TEXT),
      );

      await user.click(await screen.findByRole("button", { name: /resend/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC_FAILURE);
      expect(document.body).not.toHaveTextContent(PROVIDER_TEXT);
    },
  );
});
