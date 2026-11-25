/**
 * FRONTEND-002 acceptance criterion 7 — creating the application profile.
 *
 * Sign-up created a Cognito identity. This creates the `User` row, and it is
 * the only place in the app that sends `date_of_birth`
 * ([[0x01c-users-routes]] — `POST /users` requires `username` and `date_of_birth`).
 *
 * The age gate is a Pydantic 422 naming `date_of_birth` in `detail[].loc`. It
 * has to land on that input. A generic "could not create your profile" banner
 * for a rule the form never mentioned is the failure this criterion names, and
 * it is the one error here the user can actually do nothing about — so the
 * server's own message is what gets surfaced, on the field it is about.
 *
 * `preferred_team_id` is a real FK into `events/`'s `Team` table, so the choices
 * come from `GET /events/teams` rather than a hardcoded list.
 */
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import type { components } from "../api/schema";
import { FakeAuthService, renderWithAuth, teamsAre, testProfile, testSession } from "../test/auth";
import { server } from "../test/server";
import { ProfileSetupPage } from "./ProfileSetupPage";

type MeOut = components["schemas"]["MeOut"];
type CreateUserRequest = components["schemas"]["CreateUserRequest"];

const USERNAME = "raptorsfan";
const DATE_OF_BIRTH = "1994-04-05";
const AGE_GATE_MESSAGE = "Value error, must be at least 16 years old";

let submitted: CreateUserRequest | null = null;

/** What the form sent, or a failure naming the reason there is nothing to look at. */
function submittedBody(): CreateUserRequest {
  if (submitted === null) throw new Error("POST /users was never called");
  return submitted;
}

/** `POST /users` → 201, recording what the form actually sent. */
function acceptsProfile(): void {
  server.use(
    http.post("*/users", async ({ request }) => {
      submitted = (await request.json()) as CreateUserRequest;
      return HttpResponse.json<MeOut>(testProfile({ username: USERNAME }), {
        status: 201,
      });
    }),
  );
}

/** `POST /users` → 422, exactly the shape FastAPI's age-gate validator produces. */
function rejectsDateOfBirth(): void {
  server.use(
    http.post("*/users", () =>
      HttpResponse.json(
        {
          detail: [
            {
              loc: ["body", "date_of_birth"],
              msg: AGE_GATE_MESSAGE,
              type: "value_error",
            },
          ],
        },
        { status: 422 },
      ),
    ),
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

/**
 * `user.type` into `input[type=date]` is not a reliable way to produce a value
 * in jsdom — the control has no text to type into. The value is set the way the
 * browser sets it, which is what the component reads either way. Keyboard
 * reachability of this field is asserted separately, in `accessibility.test.tsx`.
 */
function setDateOfBirth(value: string): void {
  fireEvent.change(screen.getByLabelText(/date of birth/i), {
    target: { value },
  });
}

beforeEach(() => {
  submitted = null;
  server.use(teamsAre());
});

describe("ProfileSetupPage", () => {
  it("is the profile-creation view, with every input labelled", async () => {
    renderProfileSetup();

    expect(
      await screen.findByRole("heading", { name: /create your profile/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /preferred team/i })).toBeInTheDocument();
  });

  it("offers the teams the API returns as the preferred-team choice", async () => {
    renderProfileSetup();

    expect(await screen.findByRole("option", { name: "Toronto Raptors" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Phoenix Suns" })).toBeInTheDocument();
  });

  it("submits the username and date of birth, and lands on the feed", async () => {
    const user = userEvent.setup();
    acceptsProfile();
    renderProfileSetup();

    await user.type(await screen.findByLabelText(/^username$/i), USERNAME);
    setDateOfBirth(DATE_OF_BIRTH);
    await user.click(screen.getByRole("button", { name: /create profile/i }));

    expect(await screen.findByText("feed stub")).toBeInTheDocument();
    expect(submittedBody()).toMatchObject({
      username: USERNAME,
      date_of_birth: DATE_OF_BIRTH,
    });
  });

  it("sends the chosen team as its numeric id", async () => {
    const user = userEvent.setup();
    acceptsProfile();
    renderProfileSetup();

    await user.type(await screen.findByLabelText(/^username$/i), USERNAME);
    setDateOfBirth(DATE_OF_BIRTH);
    await user.selectOptions(
      screen.getByRole("combobox", { name: /preferred team/i }),
      await screen.findByRole("option", { name: "Toronto Raptors" }),
    );
    await user.click(screen.getByRole("button", { name: /create profile/i }));

    await screen.findByText("feed stub");
    expect(submittedBody().preferred_team_id).toBe(1);
  });

  it("leaves the optional fields out rather than sending empty strings", async () => {
    // `preferred_team_id` is an FK and `description` is nullable text; `""` is
    // not a valid value for either, and the backend would have to reject it.
    const user = userEvent.setup();
    acceptsProfile();
    renderProfileSetup();

    await user.type(await screen.findByLabelText(/^username$/i), USERNAME);
    setDateOfBirth(DATE_OF_BIRTH);
    await user.click(screen.getByRole("button", { name: /create profile/i }));

    await screen.findByText("feed stub");
    expect(submittedBody().preferred_team_id ?? null).toBeNull();
    expect(submittedBody().description ?? null).toBeNull();
  });

  it("puts the age gate's 422 on the date-of-birth field", async () => {
    const user = userEvent.setup();
    rejectsDateOfBirth();
    renderProfileSetup();

    await user.type(await screen.findByLabelText(/^username$/i), USERNAME);
    setDateOfBirth("2015-01-01");
    await user.click(screen.getByRole("button", { name: /create profile/i }));

    const dateOfBirth = await screen.findByLabelText(/date of birth/i);
    expect(dateOfBirth).toHaveAttribute("aria-invalid", "true");
    expect(dateOfBirth).toHaveAccessibleDescription(new RegExp(AGE_GATE_MESSAGE, "i"));
    expect(screen.getByLabelText(/^username$/i)).not.toHaveAttribute("aria-invalid", "true");
  });

  it("stays on the form when the age gate rejects the date", async () => {
    const user = userEvent.setup();
    rejectsDateOfBirth();
    renderProfileSetup();

    await user.type(await screen.findByLabelText(/^username$/i), USERNAME);
    setDateOfBirth("2015-01-01");
    await user.click(screen.getByRole("button", { name: /create profile/i }));

    await screen.findByLabelText(/date of birth/i);
    expect(screen.getByRole("heading", { name: /create your profile/i })).toBeInTheDocument();
    expect(screen.queryByText("feed stub")).toBeNull();
  });

  it("does not carry the date of birth off the form after creating the profile", async () => {
    // `date_of_birth` is PII and comes straight back in the 201's `MeOut`
    // ([[0x01-users]] Security). It belongs to the owner's own settings view,
    // and nowhere else — the leak was caught once in the backend already.
    const user = userEvent.setup();
    acceptsProfile();
    renderProfileSetup();

    await user.type(await screen.findByLabelText(/^username$/i), USERNAME);
    setDateOfBirth(DATE_OF_BIRTH);
    await user.click(screen.getByRole("button", { name: /create profile/i }));

    await screen.findByText("feed stub");
    expect(document.body.textContent ?? "").not.toContain(DATE_OF_BIRTH);
  });
});

/**
 * FRONTEND-050 — the username rule (USERS-010) on the form.
 *
 * The server owns the rule and answers a username outside it with a 422 on
 * `username`. The form does not copy the rule (no regex, `pattern` or
 * `maxLength`): it states it as a standing hint, and puts the server's own
 * `msg` on the field when the server refuses one.
 */
const USERNAME_HINT =
  "1 to 30 letters, numbers, underscores or dots. No two dots in a row, and no dot at the end.";
const USERNAME_RULE_MESSAGE =
  "Use 1 to 30 letters, numbers, underscores or dots, with no two dots in a row and no dot at the end.";

/** `POST /users` → 422 on `username`, as USERS-010's validator produces it, recording the body. */
function rejectsUsername(): void {
  server.use(
    http.post("*/users", async ({ request }) => {
      submitted = (await request.json()) as CreateUserRequest;
      return HttpResponse.json(
        {
          detail: [
            {
              loc: ["body", "username"],
              msg: USERNAME_RULE_MESSAGE,
              type: "username_format",
            },
          ],
        },
        { status: 422 },
      );
    }),
  );
}

describe("ProfileSetupPage: the username rule (FRONTEND-050)", () => {
  it("states the username rule as a hint in the field's description before any submit", async () => {
    renderProfileSetup();

    const username = await screen.findByLabelText(/^username$/i);
    expect(username.getAttribute("aria-describedby") ?? "").toContain(
      "profile-username-hint",
    );
    expect(username).toHaveAccessibleDescription(USERNAME_HINT);
    expect(username).not.toHaveAttribute("aria-invalid");
  });

  it("puts the server's username 422 on the field, beside the hint, with no banner", async () => {
    const user = userEvent.setup();
    rejectsUsername();
    renderProfileSetup();

    await user.type(await screen.findByLabelText(/^username$/i), "bad-name.");
    setDateOfBirth(DATE_OF_BIRTH);
    await user.click(screen.getByRole("button", { name: /create profile/i }));

    const username = await screen.findByLabelText(/^username$/i);
    await screen.findByText(USERNAME_RULE_MESSAGE);
    expect(username).toHaveAttribute("aria-invalid", "true");
    expect(username).toHaveAccessibleDescription(
      expect.stringContaining(USERNAME_RULE_MESSAGE),
    );
    expect(username).toHaveAccessibleDescription(
      expect.stringContaining(USERNAME_HINT),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("heading", { name: /create your profile/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("feed stub")).toBeNull();
  });

  it("sends a rule-breaking username to the server rather than checking it itself", async () => {
    const user = userEvent.setup();
    rejectsUsername();
    renderProfileSetup();

    const username = await screen.findByLabelText(/^username$/i);
    expect(username).not.toHaveAttribute("pattern");
    expect(username).not.toHaveAttribute("maxlength");

    await user.type(username, "bad-name.");
    setDateOfBirth(DATE_OF_BIRTH);
    await user.click(screen.getByRole("button", { name: /create profile/i }));

    await screen.findByText(USERNAME_RULE_MESSAGE);
    expect(submittedBody().username).toBe("bad-name.");
  });
});
