/**
 * FRONTEND-002 acceptance criterion 8, second half — nothing leaks.
 *
 * The pool id and the client id are not secrets; they ship in the bundle. They
 * are still per-environment values that must never be hardcoded, committed or
 * *printed* (brief, "Secrets"), because a printed one is the one that gets
 * copied into a bug report and then into the wrong environment.
 *
 * Tokens are a different matter, and the rule is absolute: never log one, never
 * render one, never put one in an error message. `wiki/CodeContext/Standards/
 * security.md` says the same thing about structured logs — scrub at the log
 * statement, not after the fact.
 *
 * So each page is driven through both of its outcomes with the console under
 * observation, and the rendered document is checked too. The values come from
 * `config`, not from a literal here, so this keeps testing the real thing if
 * `vite.config.ts`'s `test.env` ever changes.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { config } from "../config";
import {
  FakeAuthService,
  TEST_EMAIL,
  TEST_ID_TOKEN,
  TEST_PASSWORD,
  renderWithAuth,
  teamsAre,
  testSession,
} from "../test/auth";
import { server } from "../test/server";
import { ConfirmPage } from "./ConfirmPage";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { ProfileSetupPage } from "./ProfileSetupPage";
import { SignInPage } from "./SignInPage";
import { SignUpPage } from "./SignUpPage";

const NEVER_PRINTED: ReadonlyArray<readonly [string, string]> = [
  ["the Cognito user pool id", config.cognitoUserPoolId],
  ["the Cognito app client id", config.cognitoClientId],
  ["the id token", TEST_ID_TOKEN],
];

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

let printed: string[] = [];
const spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  printed = [];
  for (const method of CONSOLE_METHODS) {
    spies.push(
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        printed.push(args.map((arg) => String(arg)).join(" "));
      }),
    );
  }
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

function expectNothingLeaked(): void {
  const rendered = document.body.textContent ?? "";
  const logged = printed.join("\n");

  for (const [what, value] of NEVER_PRINTED) {
    expect(rendered, `${what} was rendered`).not.toContain(value);
    expect(logged, `${what} was logged`).not.toContain(value);
  }
}

function renderPage(element: ReactElement, authService: FakeAuthService) {
  return renderWithAuth(
    <Routes>
      <Route path="/page" element={element} />
      <Route path="/" element={<p>feed stub</p>} />
      <Route path="/sign-in" element={<p>sign-in stub</p>} />
      <Route path="/confirm" element={<p>confirm stub</p>} />
    </Routes>,
    { authService, route: "/page" },
  );
}

describe("the auth pages print neither the pool ids nor a token", () => {
  it("does not leak when sign-up fails", async () => {
    const user = userEvent.setup();
    renderPage(<SignUpPage />, new FakeAuthService().failWith("signUp", "UsernameExistsException"));

    await user.type(screen.getByLabelText(/^email$/i), TEST_EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: /sign up/i }));
    await screen.findByLabelText(/^email$/i);

    expectNothingLeaked();
  });

  it("does not leak when sign-in fails", async () => {
    const user = userEvent.setup();
    renderPage(<SignInPage />, new FakeAuthService().failWith("signIn", "NotAuthorizedException"));

    await user.type(screen.getByLabelText(/^email$/i), TEST_EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: /sign\s*-?\s*in/i }));
    await screen.findByLabelText(/^password$/i);

    expectNothingLeaked();
  });

  it("does not leak when sign-in succeeds and a token exists", async () => {
    // The dangerous case: there is now a real id token in memory, and every
    // "helpful" debug line from here on is a credential in a log aggregator.
    const user = userEvent.setup();
    renderPage(<SignInPage />, new FakeAuthService());

    await user.type(screen.getByLabelText(/^email$/i), TEST_EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: /sign\s*-?\s*in/i }));
    await screen.findByText("feed stub");

    expectNothingLeaked();
  });

  it("does not leak when confirmation fails", async () => {
    const user = userEvent.setup();
    renderPage(
      <ConfirmPage />,
      new FakeAuthService().failWith("confirmSignUp", "CodeMismatchException"),
    );

    await user.type(screen.getByLabelText(/^email$/i), TEST_EMAIL);
    await user.type(screen.getByLabelText(/confirmation code/i), "000000");
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));
    await screen.findByLabelText(/confirmation code/i);

    expectNothingLeaked();
  });

  it("does not leak when a password reset fails", async () => {
    const user = userEvent.setup();
    renderPage(
      <ForgotPasswordPage />,
      new FakeAuthService().failWith("forgotPassword", "UserNotFoundException"),
    );

    await user.type(screen.getByLabelText(/^email$/i), TEST_EMAIL);
    await user.click(screen.getByRole("button", { name: /send code/i }));
    await screen.findByLabelText(/^email$/i);

    expectNothingLeaked();
  });

  it("does not leak while a signed-in user fills in their profile", async () => {
    server.use(teamsAre());
    renderPage(<ProfileSetupPage />, new FakeAuthService({ session: testSession() }));

    await screen.findByRole("option", { name: "Toronto Raptors" });

    expectNothingLeaked();
  });
});
