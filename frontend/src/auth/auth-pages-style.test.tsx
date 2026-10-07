/**
 * UI-004 acceptance criteria 1–4: the five auth pages in the narrow form-card
 * template (`wiki/CodeContext/FrontendUI/layout.md` §3) built from the shared
 * components (`components.md` §2, §5).
 *
 * - Criterion 1: each page's form, and its `h1`, sit inside one `Card`.
 * - Criterion 2: every request failure renders through `InlineAlert` — still
 *   `role="alert"`, still the same text — at the top of that card.
 * - Criterion 3: Confirm's resend notice renders through `StatusLine`
 *   (neutral), still `role="status"`, still the same text.
 * - Criterion 4: every submit button is `Button` variant primary; "Resend
 *   code" is variant secondary.
 *
 * Classes are asserted only through each module's own export
 * (`verification.md` §2c). On Vitest 4 a CSS Module import returns a hashed
 * name for any key, so these prove the component *applies* the class; that the
 * shared rules exist is UI-002's static test, and this unit's own narrow-card
 * rule is pinned from disk in `auth-css.test.ts`.
 *
 * Failures are triggered the way the page tests do: a `FakeAuthService`
 * rejection with a code the page maps to no field (so it is about the request,
 * not a control), and msw error responses for `POST /users`.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Navigate, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import buttonStyles from "../components/ui/Button.module.css";
import cardStyles from "../components/ui/Card.module.css";
import messageStyles from "../components/ui/message.module.css";
import {
  FakeAuthService,
  TEST_EMAIL,
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

type User = ReturnType<typeof userEvent.setup>;

/** A Cognito code none of the five pages maps to a field: a request failure. */
const UNMAPPED_CODE = "LimitExceededException";
const CODE = "123456";

function renderSignIn(authService = new FakeAuthService()) {
  return renderWithAuth(
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/" element={<p>feed stub</p>} />
    </Routes>,
    { authService, route: "/sign-in" },
  );
}

function renderSignUp(authService = new FakeAuthService()) {
  return renderWithAuth(
    <Routes>
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/confirm" element={<p>confirm stub</p>} />
      <Route path="/sign-in" element={<p>sign-in stub</p>} />
    </Routes>,
    { authService, route: "/sign-up" },
  );
}

function renderConfirm(authService = new FakeAuthService()) {
  return renderWithAuth(
    <Routes>
      <Route
        path="/"
        element={
          <Navigate to="/confirm" state={{ email: TEST_EMAIL }} replace />
        }
      />
      <Route path="/confirm" element={<ConfirmPage />} />
      <Route path="/sign-in" element={<p>sign-in stub</p>} />
    </Routes>,
    { authService, route: "/" },
  );
}

function renderForgotPassword(authService = new FakeAuthService()) {
  return renderWithAuth(
    <Routes>
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/sign-in" element={<p>sign-in stub</p>} />
    </Routes>,
    { authService, route: "/forgot-password" },
  );
}

function renderProfileSetup() {
  return renderWithAuth(
    <Routes>
      <Route path="/create-profile" element={<ProfileSetupPage />} />
      <Route path="/" element={<p>feed stub</p>} />
    </Routes>,
    {
      authService: new FakeAuthService({ session: testSession() }),
      route: "/create-profile",
    },
  );
}

/** The card around `element`, or a failure naming what was not in one. */
function cardAround(element: HTMLElement, what: string): HTMLElement {
  const card = element.closest<HTMLElement>(`.${cardStyles.card}`);
  if (card === null) throw new Error(`${what} is not inside a Card`);
  return card;
}

/** The page's one `h1`, and the card it sits in. */
async function headingCard(): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { level: 1 });
  return cardAround(heading, "the h1");
}

/** The form holding `control`, and the same card the `h1` is in. */
async function expectFormInHeadingCard(control: HTMLElement): Promise<void> {
  const form = control.closest("form");
  expect(form, "the control is not inside a <form>").not.toBeNull();
  const card = cardAround(form as HTMLElement, "the form");
  expect(card).toBe(await headingCard());
}

/** A request failure: InlineAlert's danger class, exact text, top of the card. */
async function expectRequestAlert(text: string): Promise<void> {
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(text, { normalizeWhitespace: true });
  expect(alert.textContent?.trim()).toBe(text);
  expect(alert).toHaveClass(messageStyles.danger);
  expect(cardAround(alert, "the request alert")).toBe(await headingCard());
}

function expectPrimary(button: HTMLElement): void {
  expect(button).toHaveClass(buttonStyles.button);
  expect(button).toHaveClass(buttonStyles.primary);
  expect(button).not.toHaveClass(buttonStyles.secondary);
}

async function signInWith(user: User): Promise<void> {
  await user.type(await screen.findByLabelText(/^email$/i), TEST_EMAIL);
  await user.type(screen.getByLabelText(/^password$/i), TEST_PASSWORD);
  await user.click(screen.getByRole("button", { name: /^sign in$/i }));
}

async function signUpWith(user: User): Promise<void> {
  await user.type(await screen.findByLabelText(/^email$/i), TEST_EMAIL);
  await user.type(screen.getByLabelText(/^password$/i), TEST_PASSWORD);
  await user.click(screen.getByRole("button", { name: /^sign up$/i }));
}

async function requestCode(user: User): Promise<void> {
  await user.type(await screen.findByLabelText(/^email$/i), TEST_EMAIL);
  await user.click(screen.getByRole("button", { name: /^send code$/i }));
}

async function submitNewPassword(user: User): Promise<void> {
  await user.type(await screen.findByLabelText(/confirmation code/i), CODE);
  await user.type(
    screen.getByLabelText(/new password/i),
    `${TEST_PASSWORD}-new`,
  );
  await user.click(screen.getByRole("button", { name: /^reset password$/i }));
}

async function createProfileWith(user: User): Promise<void> {
  await user.type(await screen.findByLabelText(/^username$/i), "raptorsfan");
  await user.click(screen.getByRole("button", { name: /^create profile$/i }));
}

describe("SignInPage in the narrow form card", () => {
  it("puts the h1 and the form inside one Card (criterion 1)", async () => {
    renderSignIn();
    await expectFormInHeadingCard(await screen.findByLabelText(/^email$/i));
  });

  it("renders a request failure through InlineAlert (criterion 2)", async () => {
    const user = userEvent.setup();
    const text = "Too many attempts. Wait a moment and try again.";
    renderSignIn(new FakeAuthService().failWith("signIn", UNMAPPED_CODE, text));

    await signInWith(user);

    await expectRequestAlert(text);
  });

  it("renders Sign in as a primary Button (criterion 4)", async () => {
    renderSignIn();
    expectPrimary(await screen.findByRole("button", { name: /^sign in$/i }));
  });
});

describe("SignUpPage in the narrow form card", () => {
  it("puts the h1 and the form inside one Card (criterion 1)", async () => {
    renderSignUp();
    await expectFormInHeadingCard(await screen.findByLabelText(/^email$/i));
  });

  it("renders a request failure through InlineAlert (criterion 2)", async () => {
    const user = userEvent.setup();
    const text = "Sign-up is unavailable right now.";
    renderSignUp(new FakeAuthService().failWith("signUp", UNMAPPED_CODE, text));

    await signUpWith(user);

    await expectRequestAlert(text);
  });

  it("renders Sign up as a primary Button (criterion 4)", async () => {
    renderSignUp();
    expectPrimary(await screen.findByRole("button", { name: /^sign up$/i }));
  });
});

describe("ConfirmPage in the narrow form card", () => {
  it("puts the h1 and the form inside one Card (criterion 1)", async () => {
    renderConfirm();
    await expectFormInHeadingCard(
      await screen.findByLabelText(/confirmation code/i),
    );
  });

  it("renders a failed confirmation through InlineAlert (criterion 2)", async () => {
    const user = userEvent.setup();
    const text = "Confirmation is unavailable right now.";
    renderConfirm(
      new FakeAuthService().failWith("confirmSignUp", UNMAPPED_CODE, text),
    );

    await user.type(await screen.findByLabelText(/confirmation code/i), CODE);
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    await expectRequestAlert(text);
  });

  it("renders a failed resend through InlineAlert (criterion 2)", async () => {
    const user = userEvent.setup();
    const text = "You have asked for too many codes. Try again later.";
    renderConfirm(
      new FakeAuthService().failWith(
        "resendConfirmationCode",
        UNMAPPED_CODE,
        text,
      ),
    );

    await user.click(
      await screen.findByRole("button", { name: /^resend code$/i }),
    );

    await expectRequestAlert(text);
  });

  it("renders the resend notice through StatusLine, neutral (criterion 3)", async () => {
    const user = userEvent.setup();
    const text = "We have sent another code to that address.";
    renderConfirm();

    await user.click(
      await screen.findByRole("button", { name: /^resend code$/i }),
    );

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(text);
    expect(status.textContent?.trim()).toBe(text);
    expect(status).toHaveClass(messageStyles.neutral);
  });

  it("renders Confirm as a primary Button (criterion 4)", async () => {
    renderConfirm();
    expectPrimary(await screen.findByRole("button", { name: /^confirm$/i }));
  });

  it("renders Resend code as a secondary Button (criterion 4)", async () => {
    renderConfirm();
    const resend = await screen.findByRole("button", {
      name: /^resend code$/i,
    });
    expect(resend).toHaveClass(buttonStyles.button);
    expect(resend).toHaveClass(buttonStyles.secondary);
    expect(resend).not.toHaveClass(buttonStyles.primary);
  });
});

describe("ForgotPasswordPage in the narrow form card", () => {
  it("puts the h1 and the request form inside one Card (criterion 1)", async () => {
    renderForgotPassword();
    await expectFormInHeadingCard(await screen.findByLabelText(/^email$/i));
  });

  it("puts the h1 and the reset form inside one Card (criterion 1)", async () => {
    const user = userEvent.setup();
    renderForgotPassword();

    await requestCode(user);

    await expectFormInHeadingCard(
      await screen.findByLabelText(/confirmation code/i),
    );
  });

  it("renders a failed code request through InlineAlert (criterion 2)", async () => {
    const user = userEvent.setup();
    const text = "Password reset is unavailable right now.";
    renderForgotPassword(
      new FakeAuthService().failWith("forgotPassword", UNMAPPED_CODE, text),
    );

    await requestCode(user);

    await expectRequestAlert(text);
  });

  it("renders a failed reset through InlineAlert (criterion 2)", async () => {
    const user = userEvent.setup();
    const text = "Too many reset attempts. Try again later.";
    renderForgotPassword(
      new FakeAuthService().failWith(
        "confirmForgotPassword",
        UNMAPPED_CODE,
        text,
      ),
    );

    await requestCode(user);
    await submitNewPassword(user);

    await expectRequestAlert(text);
  });

  it("renders Send code as a primary Button (criterion 4)", async () => {
    renderForgotPassword();
    expectPrimary(await screen.findByRole("button", { name: /^send code$/i }));
  });

  it("renders Reset password as a primary Button (criterion 4)", async () => {
    const user = userEvent.setup();
    renderForgotPassword();

    await requestCode(user);

    expectPrimary(
      await screen.findByRole("button", { name: /^reset password$/i }),
    );
  });
});

describe("ProfileSetupPage in the narrow form card", () => {
  beforeEach(() => {
    server.use(teamsAre());
  });

  it("puts the h1 and the form inside one Card (criterion 1)", async () => {
    renderProfileSetup();
    await expectFormInHeadingCard(await screen.findByLabelText(/^username$/i));
  });

  it("renders a 409 through InlineAlert (criterion 2)", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/users", () =>
        HttpResponse.json({ detail: "conflict" }, { status: 409 }),
      ),
    );
    renderProfileSetup();

    await createProfileWith(user);

    await expectRequestAlert(
      "That username is already taken, or that team no longer exists.",
    );
  });

  it("renders a server error through InlineAlert (criterion 2)", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/users", () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ),
    );
    renderProfileSetup();

    await createProfileWith(user);

    await expectRequestAlert(
      "We could not create your profile. Please try again.",
    );
  });

  it("renders a network failure through InlineAlert (criterion 2)", async () => {
    const user = userEvent.setup();
    server.use(http.post("*/users", () => HttpResponse.error()));
    renderProfileSetup();

    await createProfileWith(user);

    await expectRequestAlert(
      "We could not create your profile. Please try again.",
    );
  });

  it("renders Create profile as a primary Button (criterion 4)", async () => {
    renderProfileSetup();
    expectPrimary(
      await screen.findByRole("button", { name: /^create profile$/i }),
    );
  });
});
