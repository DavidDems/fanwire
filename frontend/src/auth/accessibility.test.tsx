/**
 * FRONTEND-002 acceptance criterion 9 — the accessibility baseline, for all
 * five pages at once.
 *
 * "Every form input has an associated label, every control is reachable by
 * keyboard." The rest of the suite gets the first half for free, because it
 * queries by label and would not find an unlabelled input — but "for free" also
 * means "silently dropped if one page starts using a placeholder instead". So
 * it is asserted directly here, through the accessible name, which is what a
 * screen reader announces.
 *
 * Keyboard reach is the half nothing else covers. A `<div onClick>` styled as a
 * button renders, clicks in a test, and cannot be reached with Tab. The sweep
 * below tabs through the document and checks every control turned up.
 *
 * `role="combobox"` and `role="textbox"` do not cover a password or a date
 * input, which are exactly the two most likely to lose their label, so each
 * page names its own controls rather than relying on a role sweep.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { FakeAuthService, renderWithAuth, teamsAre, testSession } from "../test/auth";
import { server } from "../test/server";
import { ConfirmPage } from "./ConfirmPage";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { ProfileSetupPage } from "./ProfileSetupPage";
import { SignInPage } from "./SignInPage";
import { SignUpPage } from "./SignUpPage";

interface PageCase {
  name: string;
  element: ReactElement;
  heading: RegExp;
  authService: () => FakeAuthService;
  arrange?: () => void;
  /** The controls this page owes a label and a tab stop, collected after render. */
  controls: () => HTMLElement[];
}

const CASES: PageCase[] = [
  {
    name: "SignUpPage",
    element: <SignUpPage />,
    heading: /sign\s*-?\s*up/i,
    authService: () => new FakeAuthService(),
    controls: () => [
      screen.getByLabelText(/^email$/i),
      screen.getByLabelText(/^password$/i),
      ...screen.getAllByRole("button"),
    ],
  },
  {
    name: "SignInPage",
    element: <SignInPage />,
    heading: /sign\s*-?\s*in/i,
    authService: () => new FakeAuthService(),
    controls: () => [
      screen.getByLabelText(/^email$/i),
      screen.getByLabelText(/^password$/i),
      ...screen.getAllByRole("button"),
    ],
  },
  {
    name: "ConfirmPage",
    element: <ConfirmPage />,
    heading: /confirm/i,
    authService: () => new FakeAuthService(),
    controls: () => [
      screen.getByLabelText(/^email$/i),
      screen.getByLabelText(/confirmation code/i),
      ...screen.getAllByRole("button"),
    ],
  },
  {
    name: "ForgotPasswordPage",
    element: <ForgotPasswordPage />,
    heading: /forgot\s*-?\s*password/i,
    authService: () => new FakeAuthService(),
    controls: () => [screen.getByLabelText(/^email$/i), ...screen.getAllByRole("button")],
  },
  {
    name: "ProfileSetupPage",
    element: <ProfileSetupPage />,
    heading: /create your profile/i,
    authService: () => new FakeAuthService({ session: testSession() }),
    arrange: () => server.use(teamsAre()),
    controls: () => [
      screen.getByLabelText(/^username$/i),
      screen.getByLabelText(/date of birth/i),
      screen.getByLabelText(/description/i),
      screen.getByRole("combobox", { name: /preferred team/i }),
      ...screen.getAllByRole("button"),
    ],
  },
];

async function renderCase(page: PageCase) {
  page.arrange?.();
  renderWithAuth(
    <Routes>
      <Route path="/page" element={page.element} />
      <Route path="/" element={<p>feed stub</p>} />
    </Routes>,
    { authService: page.authService(), route: "/page" },
  );
  await screen.findByRole("heading", { name: page.heading });
}

/** Everything Tab can reach from where the document starts. */
async function tabThrough(user: ReturnType<typeof userEvent.setup>): Promise<Set<Element>> {
  const reached = new Set<Element>();
  // More than any of these pages has, so a page can add a link without this
  // turning into a maintenance chore; the loop wraps round harmlessly.
  for (let step = 0; step < 25; step += 1) {
    await user.tab();
    const focused = document.activeElement;
    if (focused && focused !== document.body) reached.add(focused);
  }
  return reached;
}

describe("the auth pages meet the accessibility baseline", () => {
  it.each(CASES)("$name labels every control", async (page) => {
    await renderCase(page);

    for (const control of page.controls()) {
      expect(control, `a control on ${page.name} has no accessible name`).toHaveAccessibleName();
    }
  });

  it.each(CASES)("$name puts every control on the tab order", async (page) => {
    const user = userEvent.setup();
    await renderCase(page);
    const controls = page.controls();

    const reached = await tabThrough(user);

    for (const control of controls) {
      expect(
        reached.has(control),
        `a control on ${page.name} cannot be reached with the keyboard`,
      ).toBe(true);
    }
  });
});
