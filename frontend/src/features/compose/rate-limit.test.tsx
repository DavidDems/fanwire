/**
 * FRONTEND-026: a `POST /posts` answered 429, as both composers show it.
 *
 * `POSTS-002` answers 429 at either of two windows (`0x03-posts.md` "Rate
 * limiting") and the API stage throttle answers it from the edge with a body
 * of another shape, so what decides the message is the status alone: a JSON
 * body, the edge's body and no body at all all read the same. The wording is
 * asserted exactly, so changing it is a deliberate edit here. It names no
 * duration, because either window can trip it, and repeats neither the
 * server's detail nor the status.
 *
 * Every other status keeps what it showed before this unit. Those cases are
 * green before the implementation: they are protection, not new behaviour.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import { renderWithAuth } from "../../test/auth";
import {
  mediaStatuses,
  s3Upload,
  testFile,
  uploadTicket,
} from "../../test/compose";
import { imageFileInput } from "../../test/compose-modal";
import { server } from "../../test/server";
import { ComposePage } from "./ComposePage";
import { InlineComposer } from "./InlineComposer";
import { refusalMessage } from "./dataLink";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];

const COMPOSE_RATE_LIMITED =
  "You are posting too quickly. Your draft is still here — please wait a little and try again.";
const REPLY_RATE_LIMITED =
  "You are posting too quickly. Your reply is still here — please wait a little and try again.";
const GENERIC_FAILURE =
  "We could not post that. Your draft is still here — please try again.";
const REPLY_FAILURE =
  "We could not post your reply. It is still here — please try again.";

/** The three bodies a 429 can arrive with. */
const RATE_LIMIT_ANSWERS: [string, () => Response][] = [
  [
    "the API's JSON body",
    () => HttpResponse.json({ detail: "rate limit exceeded" }, { status: 429 }),
  ],
  ["an empty body", () => new HttpResponse(null, { status: 429 })],
  [
    "the edge's body, which has no detail",
    () => HttpResponse.json({ message: "Too Many Requests" }, { status: 429 }),
  ],
];

/** `POST /posts`, always answered by `answer`; returns the bodies it was sent. */
function postsAnswer(answer: () => Response): CreatePostRequest[] {
  const bodies: CreatePostRequest[] = [];
  server.use(
    http.post("*/posts", async ({ request }) => {
      bodies.push((await request.clone().json()) as CreatePostRequest);
      return answer();
    }),
  );
  return bodies;
}

function refusedWith(status: number, detail: unknown = "server words") {
  return () => HttpResponse.json({ detail }, { status });
}

/** The one failure on screen, and that it is the only one. */
async function theAlert(): Promise<HTMLElement> {
  await screen.findByRole("alert");
  const alerts = screen.getAllByRole("alert");
  expect(alerts).toHaveLength(1);
  return alerts[0];
}

/** What a rate-limit message may never say, whatever it was built from. */
function expectNoServerWordsOrDuration(alert: HTMLElement): void {
  const text = alert.textContent ?? "";
  expect(text).not.toMatch(/rate limit exceeded/i);
  expect(text).not.toMatch(/too many requests/i);
  expect(text).not.toMatch(/\d/);
  expect(text).not.toMatch(/\b(second|minute|hour)s?\b/i);
}

describe("ComposePage, a 429 from POST /posts", () => {
  function composerAt(route = "/compose") {
    renderWithAuth(<ComposePage />, { route });
    return userEvent.setup();
  }
  const textBox = () => screen.getByRole("textbox", { name: /post/i });
  const postButton = () => screen.getByRole("button", { name: /^post$/i });

  it.each(RATE_LIMIT_ANSWERS)(
    "shows the rate-limit message for %s, and nothing the server said",
    async (_name, answer) => {
      postsAnswer(answer);
      const user = composerAt();

      await user.type(textBox(), "Raptors in 6");
      await user.click(postButton());

      const alert = await theAlert();
      expect(alert).toHaveTextContent(COMPOSE_RATE_LIMITED);
      expectNoServerWordsOrDuration(alert);
    },
  );

  it("shows it in the footer beside Post, not somewhere else", async () => {
    postsAnswer(RATE_LIMIT_ANSWERS[0][1]);
    const user = composerAt();

    await user.type(textBox(), "Raptors in 6");
    await user.click(postButton());

    const alert = await theAlert();
    expect(alert).toHaveTextContent(COMPOSE_RATE_LIMITED);
    expect(alert.parentElement).toContainElement(
      postButton() as HTMLButtonElement,
    );
  });

  it("keeps the text and the attachment, and a second press sends the same body", async () => {
    server.use(
      uploadTicket(),
      s3Upload(),
      mediaStatuses({ statuses: ["processed"] }),
    );
    const bodies = postsAnswer(RATE_LIMIT_ANSWERS[0][1]);
    const user = composerAt();

    await user.type(textBox(), "Raptors in 6");
    await user.upload(imageFileInput(), testFile());
    await screen.findByRole("button", { name: "Remove image" });
    await user.click(postButton());

    const alert = await theAlert();
    expect(alert).toHaveTextContent(COMPOSE_RATE_LIMITED);
    expect(textBox()).toHaveValue("Raptors in 6");
    expect(screen.getByRole("img")).toBeInTheDocument();

    await waitFor(() => expect(postButton()).toBeEnabled());
    await user.click(postButton());

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0].media_ids).toHaveLength(1);
  });

  it("does the same for a quote repost, which is posted from here", async () => {
    const bodies = postsAnswer(RATE_LIMIT_ANSWERS[0][1]);
    const user = composerAt("/compose?repost_of=7");

    await user.type(textBox(), "Hot take on this");
    await user.click(postButton());

    const alert = await theAlert();
    expect(alert).toHaveTextContent(COMPOSE_RATE_LIMITED);
    expect(bodies[0]).toMatchObject({ is_repost: true, original_post_id: 7 });
    expect(textBox()).toHaveValue("Hot take on this");

    await waitFor(() => expect(postButton()).toBeEnabled());
    await user.click(postButton());

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual(bodies[0]);
  });
});

describe("ComposePage, every other status is unchanged", () => {
  async function submitAgainst(answer: () => Response): Promise<HTMLElement> {
    postsAnswer(answer);
    renderWithAuth(<ComposePage />, { route: "/compose" });
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: /post/i }),
      "Raptors in 6",
    );
    await user.click(screen.getByRole("button", { name: /^post$/i }));
    return theAlert();
  }

  it.each([400, 409, 500])("%i shows the generic failure", async (status) => {
    expect(await submitAgainst(refusedWith(status))).toHaveTextContent(
      GENERIC_FAILURE,
    );
  });

  it("a 422 with a known code still goes through refusalMessage", async () => {
    const expected = refusalMessage("data_link_on_reply");
    expect(expected).not.toBeNull();
    expect(
      await submitAgainst(refusedWith(422, "data_link_on_reply")),
    ).toHaveTextContent(expected as string);
  });

  it("a 422 with an unknown code still shows the generic failure", async () => {
    expect(
      await submitAgainst(refusedWith(422, "not_a_code")),
    ).toHaveTextContent(GENERIC_FAILURE);
  });
});

describe("InlineComposer", () => {
  async function replyAgainst(answer: () => Response): Promise<HTMLElement> {
    postsAnswer(answer);
    renderWithAuth(
      <InlineComposer parentPostId={101} parentUsername="raptorsfan" />,
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: /your reply/i }),
      "Called it",
    );
    await user.click(screen.getByRole("button", { name: "Reply" }));
    return theAlert();
  }

  it.each(RATE_LIMIT_ANSWERS)(
    "a 429 with %s shows the reply's rate-limit message and keeps the reply",
    async (_name, answer) => {
      const alert = await replyAgainst(answer);

      expect(alert).toHaveTextContent(REPLY_RATE_LIMITED);
      expectNoServerWordsOrDuration(alert);
      expect(screen.getByRole("textbox", { name: /your reply/i })).toHaveValue(
        "Called it",
      );
    },
  );

  it.each([400, 409, 422, 500])(
    "%i shows its existing message",
    async (status) => {
      expect(await replyAgainst(refusedWith(status))).toHaveTextContent(
        REPLY_FAILURE,
      );
    },
  );
});
