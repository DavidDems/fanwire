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
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
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
import { AccountSettings } from "../features/account/AccountSettings";
import { meStub } from "../test/users";

const NEVER_PRINTED: ReadonlyArray<readonly [string, string]> = [
  ["the Cognito user pool id", config.cognitoUserPoolId],
  ["the Cognito app client id", config.cognitoClientId],
  ["the id token", TEST_ID_TOKEN],
  ["the password entered for deactivation", TEST_PASSWORD],
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
    await user.type(screen.getByLabelText(/^confirm password$/i), TEST_PASSWORD);
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

    await user.type(await screen.findByLabelText(/^email$/i), TEST_EMAIL);
    await user.click(screen.getByRole("button", { name: /send code/i }));
    // AUTH-001: an unknown address gets the same next step as a known one.
    await screen.findByLabelText(/confirmation code/i);

    expectNothingLeaked();
  });

  it("does not leak while a signed-in user fills in their profile", async () => {
    server.use(teamsAre());
    renderPage(<ProfileSetupPage />, new FakeAuthService({ session: testSession() }));

    await screen.findByRole("option", { name: "Toronto Raptors" });

    expectNothingLeaked();
  });

  it("does not leak the deactivation password when reauthentication fails", async () => {
    const user = userEvent.setup();
    server.use(meStub().handler);
    const auth = new FakeAuthService({ session: testSession() }).failWith(
      "reauthenticate",
      "NotAuthorizedException",
      "Incorrect password.",
    );
    renderPage(<AccountSettings />, auth);

    await user.click(
      await screen.findByRole("button", { name: "Deactivate account" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: /deactivate/i,
    });
    await user.type(
      within(dialog).getByLabelText(/password/i),
      TEST_PASSWORD,
    );
    await user.click(within(dialog).getByRole("button", { name: /^deactivate$/i }));
    await within(dialog).findByRole("alert");

    expectNothingLeaked();
  });
});

/**
 * AUTH-001: the new Confirm password inputs, and the reset code, never leave
 * component state. Not to the console, not to `localStorage` or
 * `sessionStorage`, and not into a URL or navigation state, whether the two
 * passwords match or not.
 */
describe("the confirm-password values stay in component state", () => {
  const SIGN_UP_CONFIRM = "Sign-Up-Confirm-Secret-41";
  const RESET_CODE = "918273";
  const RESET_PASSWORD = "Reset-New-Secret-73";
  const RESET_CONFIRM = "Reset-Confirm-Secret-29";

  let locations: string[] = [];

  beforeEach(() => {
    locations = [];
    localStorage.clear();
    sessionStorage.clear();
  });

  /** Every location the router held, with its state, as text. */
  function LocationSpy() {
    const location = useLocation();
    locations.push(
      `${location.pathname}${location.search}${location.hash} ${JSON.stringify(location.state ?? null)}`,
    );
    return null;
  }

  function storageText(): string {
    const entries: string[] = [];
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) ?? "";
        entries.push(`${key}=${storage.getItem(key) ?? ""}`);
      }
    }
    return entries.join("\n");
  }

  function expectKept(values: readonly string[]): void {
    const logged = printed.join("\n");
    const stored = storageText();
    const located = `${locations.join("\n")}\n${window.location.href}`;
    for (const value of values) {
      expect(logged, `${value} was logged`).not.toContain(value);
      expect(stored, `${value} was stored`).not.toContain(value);
      expect(located, `${value} reached a location`).not.toContain(value);
      expect(document.body.textContent ?? "", `${value} was rendered`).not.toContain(value);
    }
  }

  function renderSpied(element: ReactElement, authService: FakeAuthService) {
    return renderWithAuth(
      <>
        <LocationSpy />
        <Routes>
          <Route path="/page" element={element} />
          <Route path="/sign-in" element={<p>sign-in stub</p>} />
          <Route path="/confirm" element={<p>confirm stub</p>} />
        </Routes>
      </>,
      { authService, route: "/page" },
    );
  }

  it("keeps a mismatched sign-up confirmation out of logs, storage and the location", async () => {
    const user = userEvent.setup();
    renderSpied(<SignUpPage />, new FakeAuthService());

    await user.type(screen.getByLabelText(/^email$/i), TEST_EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), TEST_PASSWORD);
    await user.type(screen.getByLabelText(/^confirm password$/i), SIGN_UP_CONFIRM);
    await user.click(screen.getByRole("button", { name: /sign up/i }));
    await screen.findByText(/do not match/i);

    expectKept([TEST_PASSWORD, SIGN_UP_CONFIRM]);
  });

  it("keeps a matching sign-up confirmation out of logs, storage and the location", async () => {
    const user = userEvent.setup();
    renderSpied(<SignUpPage />, new FakeAuthService());

    await user.type(screen.getByLabelText(/^email$/i), TEST_EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), SIGN_UP_CONFIRM);
    await user.type(screen.getByLabelText(/^confirm password$/i), SIGN_UP_CONFIRM);
    await user.click(screen.getByRole("button", { name: /sign up/i }));
    await screen.findByText("confirm stub");

    expectKept([SIGN_UP_CONFIRM]);
  });

  async function resetWith(confirmation: string, authService: FakeAuthService) {
    const user = userEvent.setup();
    renderSpied(<ForgotPasswordPage />, authService);

    await user.type(await screen.findByLabelText(/^email$/i), TEST_EMAIL);
    await user.click(screen.getByRole("button", { name: /send code/i }));
    await user.type(await screen.findByLabelText(/confirmation code/i), RESET_CODE);
    await user.type(screen.getByLabelText(/^new password$/i), RESET_PASSWORD);
    await user.type(screen.getByLabelText(/^confirm password$/i), confirmation);
    await user.click(screen.getByRole("button", { name: /reset password/i }));
  }

  it("keeps a mismatched reset confirmation and the code out of logs, storage and the location", async () => {
    await resetWith(RESET_CONFIRM, new FakeAuthService());
    await screen.findByText(/do not match/i);

    expectKept([RESET_CODE, RESET_PASSWORD, RESET_CONFIRM]);
  });

  it("keeps a failed reset's code and passwords out of logs, storage and the location", async () => {
    await resetWith(
      RESET_PASSWORD,
      new FakeAuthService().failWith("confirmForgotPassword", "CodeMismatchException"),
    );
    await screen.findByText(/not the one we sent/i);

    expectKept([RESET_CODE, RESET_PASSWORD]);
  });

  it("keeps a successful reset's code and passwords out of logs, storage and the location", async () => {
    await resetWith(RESET_PASSWORD, new FakeAuthService());
    await screen.findByText("sign-in stub");

    expectKept([RESET_CODE, RESET_PASSWORD]);
  });
});
