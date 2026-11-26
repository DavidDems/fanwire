/**
 * FRONTEND-002 acceptance criteria 8 and 9, then AUTH-001 — resetting a
 * forgotten password with Cognito's own code.
 *
 * Cognito splits this into two calls — `forgotPassword` sends the code,
 * `confirmForgotPassword` spends it — and they are two steps of one page rather
 * than two routes. The code is only valid for the address that requested it, so
 * a second route the user could arrive at with a different email in hand is a
 * dead end nobody can debug. The page keeps the email it sent the code to, and
 * step two does not ask for it again.
 *
 * AUTH-001 finishes it: a static reminder that a code goes only to a verified
 * address; one answer for every syntactically valid address, so the page never
 * says whether an account exists, is verified or was emailed; a Confirm
 * password field; and a sign-out before the form renders for anyone who
 * arrives signed in.
 */
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { FakeAuthService, TEST_EMAIL, TEST_PASSWORD, renderWithAuth, testSession } from "../test/auth";
import { useAuth } from "./AuthContext";
import { ForgotPasswordPage } from "./ForgotPasswordPage";

const CODE = "654321";
const NEW_PASSWORD = `${TEST_PASSWORD}-new`;

/** The one answer every valid address gets, whatever Cognito said. */
const GENERIC_ANSWER = /if an account with .*verified.* exists, a code has been sent/i;
/** The reminder the request step shows before anything is typed. */
const REMINDER = /reset code .*only to a verified email address/i;

type User = ReturnType<typeof userEvent.setup>;

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

async function requestCode(user: User, email = TEST_EMAIL) {
  await user.type(await screen.findByLabelText(/^email$/i), email);
  await user.click(screen.getByRole("button", { name: /send code/i }));
}

async function submitNewPassword(user: User, confirmation = NEW_PASSWORD) {
  await user.type(await screen.findByLabelText(/confirmation code/i), CODE);
  await user.type(screen.getByLabelText(/^new password$/i), NEW_PASSWORD);
  await user.type(screen.getByLabelText(/^confirm password$/i), confirmation);
  await user.click(screen.getByRole("button", { name: /reset password/i }));
}

/** No copy on the page may say whether an account exists, is verified, or was emailed. */
function expectNoAccountDetails(): void {
  const text = document.body.textContent ?? "";
  expect(text).not.toMatch(/there is no account/i);
  expect(text).not.toMatch(/no account (for|with)/i);
  expect(text).not.toMatch(/not (been )?verified/i);
  expect(text).not.toMatch(/unverified/i);
  expect(text).not.toMatch(/(could not|couldn't|failed to|unable to) (send|deliver)/i);
  expect(text).not.toMatch(/we have sent a code to/i);
}

describe("ForgotPasswordPage — asking for a code", () => {
  it("is the forgot-password view, with a labelled email field and a Send code button", async () => {
    renderForgotPassword(new FakeAuthService());

    expect(
      await screen.findByRole("heading", { name: /forgot\s*-?\s*password/i }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send code$/i })).toBeInTheDocument();
  });

  it("does not ask for a code before one has been sent", async () => {
    renderForgotPassword(new FakeAuthService());

    await screen.findByLabelText(/^email$/i);
    expect(screen.queryByLabelText(/confirmation code/i)).toBeNull();
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
    expect(screen.queryByLabelText(/confirm password/i)).toBeNull();
  });

  it("reminds, before anything is typed, that a code goes only to a verified address", async () => {
    renderForgotPassword(new FakeAuthService());

    await screen.findByLabelText(/^email$/i);
    const reminder = screen.getByText(REMINDER);
    expect(reminder).toHaveTextContent(/never verified/i);
    expect(reminder).toHaveTextContent(/cannot reset/i);
    // Plain text, not an alert or a live region.
    expect(reminder.closest("[role='alert'], [role='status']")).toBeNull();
  });

  it("keeps the reminder whatever is typed", async () => {
    const user = userEvent.setup();
    renderForgotPassword(new FakeAuthService());

    await user.type(await screen.findByLabelText(/^email$/i), "anything at all");

    expect(screen.getByText(REMINDER)).toBeInTheDocument();
  });

  it("asks the service for a code for that address", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService();
    renderForgotPassword(service);

    await requestCode(user);

    expect(service.callsTo("forgotPassword")).toEqual([TEST_EMAIL]);
  });

  it("reveals the code, new-password and confirm-password fields once the request is answered", async () => {
    const user = userEvent.setup();
    renderForgotPassword(new FakeAuthService());

    await requestCode(user);

    expect(await screen.findByLabelText(/confirmation code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^confirm password$/i)).toBeInTheDocument();
  });

  it("puts a syntactically invalid address on the email field and asks Cognito nothing", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService();
    renderForgotPassword(service);

    await requestCode(user, "not-an-address");

    expectFieldError(await screen.findByLabelText(/^email$/i));
    expect(service.callsTo("forgotPassword")).toEqual([]);
    expect(screen.queryByLabelText(/confirmation code/i)).toBeNull();
  });

  it("treats an empty address as invalid and asks Cognito nothing", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService();
    renderForgotPassword(service);

    await user.click(await screen.findByRole("button", { name: /send code/i }));

    expectFieldError(await screen.findByLabelText(/^email$/i));
    expect(service.callsTo("forgotPassword")).toEqual([]);
  });
});

describe("ForgotPasswordPage — one answer for every valid address", () => {
  /** What the page says after `forgotPassword` answers with `outcome`. */
  async function answerFor(outcome: string | null): Promise<string> {
    const user = userEvent.setup();
    const service = new FakeAuthService();
    if (outcome !== null) service.failWith("forgotPassword", outcome);
    const { unmount } = renderForgotPassword(service);

    await requestCode(user);
    await screen.findByLabelText(/confirmation code/i);
    expect(screen.queryByRole("alert")).toBeNull();
    expectNoAccountDetails();
    const text = screen.getByText(GENERIC_ANSWER).textContent ?? "";
    unmount();
    return text;
  }

  it("answers a Cognito success with the generic next step", async () => {
    expect(await answerFor(null)).toMatch(GENERIC_ANSWER);
  });

  it("answers UserNotFoundException with the same next step and the same words", async () => {
    const success = await answerFor(null);
    expect(await answerFor("UserNotFoundException")).toBe(success);
  });

  it("answers InvalidParameterException (an unverified account) with the same next step and the same words", async () => {
    const success = await answerFor(null);
    expect(await answerFor("InvalidParameterException")).toBe(success);
  });

  it("no longer says there is no account for the address", async () => {
    const user = userEvent.setup();
    renderForgotPassword(new FakeAuthService().failWith("forgotPassword", "UserNotFoundException"));

    await requestCode(user);
    await screen.findByLabelText(/confirmation code/i);

    expect(screen.queryByText(/there is no account for this email address/i)).toBeNull();
    expect(screen.getByLabelText(/confirmation code/i)).not.toHaveAttribute("aria-invalid", "true");
  });

  it.each(["LimitExceededException", "TooManyRequestsException"])(
    "shows one generic too-many-attempts alert for %s",
    async (code) => {
      const user = userEvent.setup();
      renderForgotPassword(
        new FakeAuthService().failWith("forgotPassword", code, `${code}: raw provider words`),
      );

      await requestCode(user);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/too many attempts/i);
      expect(alert).not.toHaveTextContent(/raw provider words/i);
      expect(screen.queryByLabelText(/confirmation code/i)).toBeNull();
      expectNoAccountDetails();
    },
  );

  it("gives both throttling codes the same words", async () => {
    const user = userEvent.setup();
    const first = renderForgotPassword(
      new FakeAuthService().failWith("forgotPassword", "LimitExceededException"),
    );
    await requestCode(user);
    const limit = (await screen.findByRole("alert")).textContent;
    first.unmount();

    renderForgotPassword(
      new FakeAuthService().failWith("forgotPassword", "TooManyRequestsException"),
    );
    await requestCode(user);
    expect((await screen.findByRole("alert")).textContent).toBe(limit);
  });

  it("never renders the provider's own words for any other failure", async () => {
    const user = userEvent.setup();
    renderForgotPassword(
      new FakeAuthService().failWith(
        "forgotPassword",
        "CodeDeliveryFailureException",
        "Unable to deliver the code to the registered address.",
      ),
    );

    await requestCode(user);

    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent(/unable to deliver/i);
    expectNoAccountDetails();
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

  it("puts a mismatched confirmation on Confirm password and makes no reset call", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService();
    renderForgotPassword(service);

    await requestCode(user);
    await submitNewPassword(user, `${NEW_PASSWORD}-typo`);

    expectFieldError(await screen.findByLabelText(/^confirm password$/i));
    expect(screen.getByLabelText(/^new password$/i)).not.toHaveAttribute("aria-invalid", "true");
    expect(service.callsTo("confirmForgotPassword")).toEqual([]);
    expect(screen.queryByText("sign-in stub")).toBeNull();
  });

  it("makes exactly one reset call once the two passwords match", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService().failWith("confirmForgotPassword", "CodeMismatchException");
    renderForgotPassword(service);

    await requestCode(user);
    await submitNewPassword(user, `${NEW_PASSWORD}-typo`);
    expectFieldError(await screen.findByLabelText(/^confirm password$/i));
    expect(service.callsTo("confirmForgotPassword")).toEqual([]);

    const confirm = screen.getByLabelText(/^confirm password$/i);
    await user.clear(confirm);
    await user.type(confirm, NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => {
      expect(service.callsTo("confirmForgotPassword")).toHaveLength(1);
    });
    expect(screen.getByLabelText(/^confirm password$/i)).not.toHaveAttribute("aria-invalid", "true");
  });

  it("puts a wrong code on the code field", async () => {
    const user = userEvent.setup();
    renderForgotPassword(
      new FakeAuthService().failWith("confirmForgotPassword", "CodeMismatchException"),
    );

    await requestCode(user);
    await submitNewPassword(user);

    expectFieldError(await screen.findByLabelText(/confirmation code/i));
    expect(screen.getByLabelText(/^new password$/i)).not.toHaveAttribute("aria-invalid", "true");
    expectNoAccountDetails();
  });

  it("puts a rejected password on the new-password field", async () => {
    const user = userEvent.setup();
    renderForgotPassword(
      new FakeAuthService().failWith("confirmForgotPassword", "InvalidPasswordException"),
    );

    await requestCode(user);
    await submitNewPassword(user);

    expectFieldError(await screen.findByLabelText(/^new password$/i));
    expect(screen.getByLabelText(/confirmation code/i)).not.toHaveAttribute("aria-invalid", "true");
    expectNoAccountDetails();
  });

  it("stays on the page when the code has expired", async () => {
    const user = userEvent.setup();
    renderForgotPassword(
      new FakeAuthService().failWith("confirmForgotPassword", "ExpiredCodeException"),
    );

    await requestCode(user);
    await submitNewPassword(user);

    expectFieldError(await screen.findByLabelText(/confirmation code/i));
    expect(screen.queryByText("sign-in stub")).toBeNull();
    expectNoAccountDetails();
  });

  it.each(["UserNotFoundException", "InvalidParameterException"])(
    "answers %s on the code step as a wrong code, naming no account detail",
    async (code) => {
      const user = userEvent.setup();
      renderForgotPassword(
        new FakeAuthService().failWith(
          "confirmForgotPassword",
          code,
          "Cannot reset password for the user as there is no registered/verified email",
        ),
      );

      await requestCode(user);
      await submitNewPassword(user);

      expectFieldError(await screen.findByLabelText(/confirmation code/i));
      expect(screen.queryByText(/registered\/verified/i)).toBeNull();
      expectNoAccountDetails();
    },
  );

  it("shows the generic too-many-attempts alert when the code step is throttled", async () => {
    const user = userEvent.setup();
    renderForgotPassword(
      new FakeAuthService().failWith(
        "confirmForgotPassword",
        "LimitExceededException",
        "Attempt limit exceeded, raw provider words",
      ),
    );

    await requestCode(user);
    await submitNewPassword(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/too many attempts/i);
    expect(alert).not.toHaveTextContent(/raw provider words/i);
  });
});

describe("ForgotPasswordPage — signed out before recovery", () => {
  let observer: MutationObserver | null = null;

  afterEach(() => {
    observer?.disconnect();
    observer = null;
  });

  /** Renders the session it reads, so the DOM says what the provider holds. */
  function SessionProbe() {
    const { session, status } = useAuth();
    return (
      <p data-testid="session-probe">
        {status}:{session === null ? "none" : "present"}
      </p>
    );
  }

  function renderWithProbe(authService: FakeAuthService) {
    return renderWithAuth(
      <>
        <SessionProbe />
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/sign-in" element={<p>sign-in stub</p>} />
        </Routes>
      </>,
      { authService, route: "/forgot-password" },
    );
  }

  it("does not render the request form while the session is still loading", async () => {
    const service = new FakeAuthService({ session: testSession() });
    const release = service.pause();
    renderWithProbe(service);

    expect(screen.getByTestId("session-probe")).toHaveTextContent("loading:");
    expect(screen.queryByLabelText(/^email$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /send code/i })).toBeNull();

    await act(async () => {
      release();
    });
    expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument();
  });

  it("signs a signed-in visitor out through AuthContext before the form renders", async () => {
    const service = new FakeAuthService({ session: testSession() });
    renderWithProbe(service);

    expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument();
    expect(service.callsTo("signOut")).toHaveLength(1);
    expect(service.session).toBeNull();
    expect(screen.getByTestId("session-probe")).toHaveTextContent("anonymous:none");
  });

  it("never has the form in the document while a session exists, so no code can be asked for", async () => {
    const service = new FakeAuthService({ session: testSession() });
    const release = service.pause();
    const violations: string[] = [];
    observer = new MutationObserver(() => {
      const probe = document.querySelector("[data-testid='session-probe']");
      const form = document.getElementById("reset-email");
      const sendCode = Array.from(document.querySelectorAll("button")).some((button) =>
        /send code/i.test(button.textContent ?? ""),
      );
      if ((form !== null || sendCode) && !/anonymous:none/.test(probe?.textContent ?? "")) {
        violations.push(probe?.textContent ?? "no probe");
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    renderWithProbe(service);
    await act(async () => {
      release();
    });
    const user = userEvent.setup();
    await requestCode(user);
    await screen.findByLabelText(/confirmation code/i);

    expect(violations).toEqual([]);
    const methods = service.calls.map((call) => call.method);
    expect(methods.indexOf("signOut")).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf("signOut")).toBeLessThan(methods.indexOf("forgotPassword"));
  });

  it("does not sign out a visitor who arrives anonymous", async () => {
    const service = new FakeAuthService();
    renderWithProbe(service);

    await screen.findByLabelText(/^email$/i);
    expect(service.callsTo("signOut")).toEqual([]);
  });
});
