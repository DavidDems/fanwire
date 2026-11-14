/**
 * FRONTEND-026: a `POST /posts/{id}/repost` answered 429, as the card shows it.
 *
 * `TogglePostAction` is shared with Like, and it is also how a repost is
 * undone. Only the repost's POST is posting, so only that one gets the
 * rate-limit message: a like, or an undo, can see a 429 only from the edge, and
 * "posting" would be wrong for either. Those cases are green before the
 * implementation: they are protection, not new behaviour.
 *
 * The wording is asserted exactly, so changing it is a deliberate edit here.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import {
  FakeAuthService,
  profileFound,
  renderWithAuth,
  testSession,
} from "../../test/auth";
import { stubImages, stubIntersectionObserver } from "../../test/card-ready";
import {
  feedPage,
  feedStub,
  testPlainRepost,
  testPostView,
  type PostView,
} from "../../test/feed";
import { server } from "../../test/server";
import { FeedPage } from "./FeedPage";
import { RepostRateLimited, setReposted } from "./api";

const REPOST_RATE_LIMITED =
  "You are posting too quickly. Please wait a little and try again.";
const GENERIC_TOGGLE_FAILURE =
  "We could not save that just now. Please try again.";

const REPOST_PATH = "*/posts/:post_id/repost";
const LIKE_PATH = "*/posts/:post_id/like";

const ORIGINAL = testPostView({
  id: 401,
  text: "Original take on the trade",
  like_count: 5,
  repost_count: 2,
});

const rateLimitedJson = () =>
  HttpResponse.json({ detail: "rate limit exceeded" }, { status: 429 });
const rateLimitedEmpty = () => new HttpResponse(null, { status: 429 });
const refusedWith = (status: number) => () =>
  HttpResponse.json({ detail: "server words" }, { status });

async function feedShowing(post: PostView) {
  stubImages({ autoLoad: true });
  stubIntersectionObserver({ intersectAll: true });
  server.use(feedStub([feedPage([post], null)]).handler, profileFound());
  renderWithAuth(
    <Routes>
      <Route path="/" element={<FeedPage />} />
    </Routes>,
    {
      authService: new FakeAuthService({ session: testSession() }),
      route: "/",
    },
  );
  await screen.findByText(ORIGINAL.text as string);
  return userEvent.setup();
}

function card(): HTMLElement {
  return screen.getByRole("article");
}

function control(name: "Repost" | "Like"): HTMLElement {
  return within(card()).getByRole("button", { name });
}

describe("a repost answered 429", () => {
  it.each([
    ["the API's JSON body", rateLimitedJson],
    ["an empty body", rateLimitedEmpty],
  ])(
    "with %s shows the rate-limit message and rolls the toggle back",
    async (_name, answer) => {
      server.use(http.post(REPOST_PATH, answer));
      const user = await feedShowing(ORIGINAL);

      await user.click(control("Repost"));

      // Read at once: the refetch after the failure would hide a missing rollback.
      const alert = await within(card()).findByRole("alert");
      expect(control("Repost")).toHaveAttribute("aria-pressed", "false");
      expect(within(card()).getByText("2 reposts")).toBeInTheDocument();

      expect(alert).toHaveTextContent(REPOST_RATE_LIMITED);
      expect(alert.textContent).not.toMatch(/rate limit exceeded/i);
      expect(alert.textContent).not.toMatch(/\d/);
      expect(alert.textContent).not.toMatch(/\b(second|minute|hour)s?\b/i);
    },
  );

  it("through a plain repost's card, which acts on the original", async () => {
    const posted: string[] = [];
    server.use(
      http.post(REPOST_PATH, ({ params }) => {
        posted.push(String(params.post_id));
        return rateLimitedJson();
      }),
    );
    const user = await feedShowing(testPlainRepost(ORIGINAL, { id: 402 }));

    await user.click(control("Repost"));

    expect(await within(card()).findByRole("alert")).toHaveTextContent(
      REPOST_RATE_LIMITED,
    );
    expect(posted).toEqual(["401"]);
  });

  it("clears the message when the next press succeeds", async () => {
    let answer = rateLimitedJson as () => Response;
    server.use(http.post(REPOST_PATH, () => answer()));
    const user = await feedShowing(ORIGINAL);

    await user.click(control("Repost"));
    await within(card()).findByRole("alert");

    answer = () => HttpResponse.json({}, { status: 201 });
    await waitFor(() => expect(control("Repost")).toBeEnabled());
    await user.click(control("Repost"));

    await waitFor(() => expect(within(card()).queryByRole("alert")).toBeNull());
  });
});

describe("what keeps the generic failure", () => {
  it.each([409, 500])("a repost answered %i", async (status) => {
    server.use(http.post(REPOST_PATH, refusedWith(status)));
    const user = await feedShowing(ORIGINAL);

    await user.click(control("Repost"));

    expect(await within(card()).findByRole("alert")).toHaveTextContent(
      GENERIC_TOGGLE_FAILURE,
    );
  });

  it("a like answered 429: a like is not posting", async () => {
    server.use(http.post(LIKE_PATH, rateLimitedJson));
    const user = await feedShowing(ORIGINAL);

    await user.click(control("Like"));

    expect(await within(card()).findByRole("alert")).toHaveTextContent(
      GENERIC_TOGGLE_FAILURE,
    );
  });

  it("an unlike answered 429", async () => {
    server.use(http.delete(LIKE_PATH, rateLimitedJson));
    const user = await feedShowing({ ...ORIGINAL, liked_by_viewer: true });

    await user.click(control("Like"));

    expect(await within(card()).findByRole("alert")).toHaveTextContent(
      GENERIC_TOGGLE_FAILURE,
    );
  });

  it("undoing a repost answered 429: an undo is not posting", async () => {
    server.use(http.delete(REPOST_PATH, rateLimitedJson));
    const user = await feedShowing({ ...ORIGINAL, reposted_by_viewer: true });

    await user.click(control("Repost"));

    expect(await within(card()).findByRole("alert")).toHaveTextContent(
      GENERIC_TOGGLE_FAILURE,
    );
    expect(control("Repost")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("setReposted's error for a POST 429", () => {
  it("is the exported class, with the message every other failure has", async () => {
    server.use(http.post(REPOST_PATH, rateLimitedEmpty));

    const error: unknown = await setReposted(401, true).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(RepostRateLimited);
    expect((error as Error).message).toBe(
      "POST /posts/401/repost answered 429",
    );
  });
});
