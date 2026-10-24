/**
 * FRONTEND-004 acceptance criterion 9, plus criteria 1, 4 and 5 as the user
 * meets them: the whole composer, with the three colleagues wired to one
 * mediator behind it.
 *
 * Two things here are load-bearing beyond the criteria themselves.
 *
 * **The page must be silent on mount.** `src/routes/routes.test.tsx` renders
 * `/compose` for a `member` visitor and pins its heading as exactly `Compose`;
 * msw runs with `onUnhandledRequest: "error"`, so a page that fetched games or
 * teams when it mounted would break a test file this unit is not allowed to
 * touch. Since `FRONTEND-013` the `#`/`$` dropdown is gone, so typing fetches
 * nothing either; the `events/` reads happen when the "Attach stats" picker
 * is used, or when a pre-filled address needs its summary.
 *
 * `FRONTEND-013` adds what the request body carries for an attachment
 * (criterion 6), the refusals POSTS-005 answers with a machine code
 * (criterion 7) and the dropdown's removal (criterion 9).
 *
 * **Draft preservation is the criterion most likely to be faked green**, because
 * the happy path is what gets clicked. A failed `POST /posts` keeps the text
 * *and* the attachment *and* says what happened *and* lets the user try again —
 * all four, or the user loses what they typed on a 500.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import {
  attachGameResult,
  attachLebronCareer,
  attachServer,
  attachedSummary,
  summaryShown,
  textOf,
} from "../../test/attach";
import { renderWithAuth } from "../../test/auth";
import {
  TEST_MEDIA_ID,
  createPost,
  mediaStatuses,
  recordRequests,
  s3Upload,
  testFile,
  uploadTicket,
  type RequestRecorder,
} from "../../test/compose";
import { imageFileInput } from "../../test/compose-modal";
import { server } from "../../test/server";
import { ComposePage } from "./ComposePage";
import { QUICK_POST_TEMPLATES } from "./PostTemplate";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];

let recorder: RequestRecorder | null = null;

afterEach(() => {
  recorder?.stop();
  recorder = null;
});

function renderComposer(route = "/compose") {
  renderWithAuth(<ComposePage />, { route });
  return userEvent.setup();
}

function textBox(): HTMLElement {
  return screen.getByRole("textbox", { name: /post/i });
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: /^post$/i });
}

/** Install the three handlers an upload needs and drive it through to attached. */
function mediaUploadSucceeds() {
  server.use(
    uploadTicket(),
    s3Upload(),
    mediaStatuses({ statuses: ["processed"] }),
  );
}

/**
 * FRONTEND-020: a processed image attaches by itself, with no Attach press,
 * so choosing the file (in the hidden input the paperclip opens) and waiting
 * for its thumbnail is the whole of it.
 */
async function attachAProcessedImage(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(imageFileInput(), testFile());
  await screen.findByRole("img");
  await screen.findByRole("button", { name: "Remove image" });
}

describe("the composer page", () => {
  // FRONTEND-020: the composer is shown in the Dialog titled "Compose", whose
  // title is the route's one "Compose" heading (`ComposeRoute.test.tsx`), so
  // the page renders no heading of that name of its own.
  it("renders no Compose heading of its own: the dialog's title is it", async () => {
    recorder = recordRequests();
    renderComposer();

    await screen.findByRole("textbox", { name: /post/i });
    expect(screen.queryByRole("heading", { name: /^compose$/i })).toBeNull();
  });

  it("issues no HTTP request when it mounts", async () => {
    // Nothing is fetched until the picker is used. A query on mount would make
    // `routes.test.tsx` fail with an unhandled request, in a file this unit
    // must leave byte-for-byte unchanged.
    recorder = recordRequests();
    renderComposer();

    await screen.findByRole("textbox", { name: /post/i });
    expect(textBox()).toBeInTheDocument();

    expect(recorder.paths()).toEqual([]);
  });

  it("will not submit a draft with neither text nor media", async () => {
    recorder = recordRequests();
    renderComposer();

    await screen.findByRole("textbox", { name: /post/i });

    expect(submitButton()).toBeDisabled();
    expect(recorder.paths()).toEqual([]);
  });
});

describe("submitting a valid draft", () => {
  it("issues POST /posts with the built request", async () => {
    const bodies: CreatePostRequest[] = [];
    mediaUploadSucceeds();
    server.use(createPost({ onRequest: (body) => bodies.push(body) }));
    const user = renderComposer();

    await user.type(textBox(), "Raptors in 6");
    await attachAProcessedImage(user);
    await user.click(submitButton());

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      text: "Raptors in 6",
      media_ids: [TEST_MEDIA_ID],
      is_reply: false,
      parent_post_id: null,
      is_repost: false,
      original_post_id: null,
    });
  });

  it("clears the composer on success", async () => {
    mediaUploadSucceeds();
    server.use(createPost());
    const user = renderComposer();

    await user.type(textBox(), "Raptors in 6");
    await attachAProcessedImage(user);
    await user.click(submitButton());

    await waitFor(() => expect(textBox()).toHaveValue(""));
    expect(
      screen.queryByRole("img"),
      "the attachment is cleared too",
    ).toBeNull();
  });
});

describe("a failed POST /posts does not cost the user their draft", () => {
  it("keeps the text, keeps the attachment, says what happened and allows a retry", async () => {
    const bodies: CreatePostRequest[] = [];
    mediaUploadSucceeds();
    server.use(
      createPost({ status: 500, onRequest: (body) => bodies.push(body) }),
    );
    const user = renderComposer();

    await user.type(textBox(), "Raptors in 6");
    await attachAProcessedImage(user);
    await user.click(submitButton());
    await waitFor(() => expect(bodies).toHaveLength(1));

    // 1. Something visible said the post did not go out.
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);

    // 2. The text is still there, exactly as typed.
    expect(textBox()).toHaveValue("Raptors in 6");

    // 3. So is the attachment.
    expect(screen.getByRole("img")).toBeInTheDocument();

    // 4. And the user can try again — with the same request, not a stripped one.
    await waitFor(() => expect(submitButton()).toBeEnabled());
    await user.click(submitButton());

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual(bodies[0]);
  });
});

describe("quick-post templates", () => {
  const template = QUICK_POST_TEMPLATES[0];

  it("starts a draft from a stored template", async () => {
    recorder = recordRequests();
    const user = renderComposer();

    await user.click(
      await screen.findByRole("button", { name: template.name }),
    );

    expect(textBox()).toHaveValue(template.clone().text);
    expect(
      recorder.paths(),
      "a template is stored in the app, not fetched",
    ).toEqual([]);
  });

  it("leaves the template itself untouched when the draft from it is edited", async () => {
    const user = renderComposer();

    await user.click(
      await screen.findByRole("button", { name: template.name }),
    );
    await user.type(textBox(), "Raptors by 12");
    await user.click(screen.getByRole("button", { name: template.name }));

    expect(textBox()).toHaveValue(template.clone().text);
  });
});

describe("the request carries the attachment exactly as attached (criterion 6)", () => {
  function arrange(route = "/compose") {
    const bodies: CreatePostRequest[] = [];
    mediaUploadSucceeds();
    server.use(
      ...attachServer().handlers,
      createPost({ onRequest: (body) => bodies.push(body) }),
    );
    const user = renderComposer(route);
    return { bodies, user };
  }

  it("sends no data_link key at all when nothing is attached", async () => {
    const { bodies, user } = arrange();

    await user.type(textBox(), "Raptors in 6");
    await user.click(submitButton());

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(Object.keys(bodies[0])).not.toContain("data_link");
  });

  it("sends a game result alongside text and media_ids, with no scope key", async () => {
    const { bodies, user } = arrange();

    await user.type(textBox(), "Raptors in 6");
    await attachAProcessedImage(user);
    await attachGameResult(user);
    await summaryShown();
    await user.click(submitButton());

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      text: "Raptors in 6",
      media_ids: [TEST_MEDIA_ID],
      is_reply: false,
      parent_post_id: null,
      is_repost: false,
      original_post_id: null,
      data_link: { type: "game_final", ref_id: 501 },
    });
    expect(Object.keys(bodies[0].data_link ?? {}).sort()).toEqual([
      "ref_id",
      "type",
    ]);
  });

  it("sends a career with its scope", async () => {
    const { bodies, user } = arrange();

    await user.type(textBox(), "GOAT");
    await attachLebronCareer(user);
    await summaryShown();
    await user.click(submitButton());

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].data_link).toEqual({
      type: "player_career",
      ref_id: 2544,
      scope: "regular",
    });
  });

  it("will not post a draft whose only content is a link", async () => {
    const { bodies, user } = arrange();

    await attachGameResult(user);
    await summaryShown();

    expect(submitButton()).toBeDisabled();
    await user.click(submitButton());
    expect(bodies).toEqual([]);
  });

  it("posts a link with an image and no text", async () => {
    const { bodies, user } = arrange();

    await attachAProcessedImage(user);
    await attachGameResult(user);
    await summaryShown();

    await waitFor(() => expect(submitButton()).toBeEnabled());
    await user.click(submitButton());
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      text: null,
      media_ids: [TEST_MEDIA_ID],
      data_link: { type: "game_final", ref_id: 501 },
    });
  });

  it("on /compose?repost_of=<id>, a link needs text, even with an image", async () => {
    const { bodies, user } = arrange("/compose?repost_of=7");

    await attachAProcessedImage(user);
    await attachGameResult(user);
    await summaryShown();

    expect(
      submitButton(),
      "a quote repost with a link and no text",
    ).toBeDisabled();

    await user.type(textBox(), "This one");
    await waitFor(() => expect(submitButton()).toBeEnabled());
    await user.click(submitButton());

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      text: "This one",
      is_repost: true,
      original_post_id: 7,
      data_link: { type: "game_final", ref_id: 501 },
    });
  });
});

const GENERIC_FAILURE =
  "We could not post that. Your draft is still here — please try again.";

/** POSTS-005's refusals that this unit gives a message of their own. */
const MACHINE_CODES = [
  "link_target_not_found",
  "game_not_completed",
  "player_did_not_play",
  "no_games_in_scope",
  "data_link_on_reply",
  "data_link_needs_quote_text",
] as const;

interface Failure {
  message: string;
  bodies: CreatePostRequest[];
  unmount: () => void;
  user: ReturnType<typeof userEvent.setup>;
}

/** Type, attach game 501 and post against a failing `POST /posts`. */
async function failWith(detail: unknown, status = 422): Promise<Failure> {
  const bodies: CreatePostRequest[] = [];
  server.use(
    ...attachServer().handlers,
    createPost({ status, detail, onRequest: (body) => bodies.push(body) }),
  );
  const { unmount } = renderWithAuth(<ComposePage />, { route: "/compose" });
  const user = userEvent.setup();

  await user.type(textBox(), "Raptors in 6");
  await attachGameResult(user);
  await summaryShown();
  await user.click(submitButton());
  await waitFor(() => expect(bodies).toHaveLength(1));

  const alerts = await screen.findAllByRole("alert");
  const message = alerts
    .map(textOf)
    .filter((text) => text !== "")
    .join(" ");
  return { message, bodies, unmount, user };
}

describe("a refused data_link keeps the draft and says why (criterion 7)", () => {
  it.each(MACHINE_CODES)(
    "%s: keeps the text and the attachment and shows its own message",
    async (code) => {
      const { message, bodies, user } = await failWith(code);

      expect(message).not.toBe("");
      expect(
        message,
        "the generic message is not specific to the refusal",
      ).not.toContain(GENERIC_FAILURE);
      expect(message, "the machine code itself is not a message").not.toContain(
        code,
      );
      expect(textBox()).toHaveValue("Raptors in 6");
      const summary = attachedSummary();
      expect(summary, "the attachment survives the refusal").not.toBeNull();
      expect(textOf(summary as HTMLElement)).toMatch(/\b117\b/);

      // And it can be tried again, with the same request.
      await waitFor(() => expect(submitButton()).toBeEnabled());
      await user.click(submitButton());
      await waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies[1]).toEqual(bodies[0]);
    },
    20_000,
  );

  it("gives each of the six codes a different message", async () => {
    const messages: string[] = [];
    for (const code of MACHINE_CODES) {
      const { message, unmount } = await failWith(code);
      messages.push(message);
      unmount();
    }

    expect(new Set(messages).size, messages.join(" | ")).toBe(
      MACHINE_CODES.length,
    );
  }, 60_000);

  it.each([
    ["a code it does not know", 422, "some_future_code"],
    [
      "Pydantic's own 422",
      422,
      [{ loc: ["body", "data_link"], msg: "bad", type: "value_error" }],
    ],
    ["a server error", 500, "Internal Server Error"],
  ] as const)(
    "keeps the generic message for %s",
    async (_name, status, detail) => {
      const { message } = await failWith(detail, status);

      expect(message).toContain(GENERIC_FAILURE);
      expect(textBox()).toHaveValue("Raptors in 6");
      expect(attachedSummary()).not.toBeNull();
    },
    20_000,
  );
});

describe("the #/$ mention dropdown is gone (criterion 9)", () => {
  it("fetches nothing when # or $ is typed", async () => {
    recorder = recordRequests();
    const user = renderComposer();

    await user.type(textBox(), "Raptors win #12 and $TO");
    // Long enough for any debounce the old dropdown might have had.
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(recorder.paths()).toEqual([]);
    expect(screen.queryByRole("region", { name: /suggestions/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /undo/i }),
      "no Undo mention",
    ).toBeNull();
  });

  it("sends a typed #GameId123 as plain text, asking for nothing on the way", async () => {
    const bodies: CreatePostRequest[] = [];
    server.use(createPost({ onRequest: (body) => bodies.push(body) }));
    recorder = recordRequests();
    const user = renderComposer();

    await user.type(textBox(), "Raptors win #GameId123");
    await user.click(submitButton());

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(
      recorder.paths().filter((path) => !path.endsWith("/posts")),
      "the only request is the post itself",
    ).toEqual([]);
    expect(bodies[0].text).toBe("Raptors win #GameId123");
    expect(Object.keys(bodies[0])).not.toContain("data_link");
  });

  it("no longer tells the user to type # or $", async () => {
    renderComposer();

    await screen.findByRole("textbox", { name: /post/i });
    expect(textBox()).not.toHaveAccessibleDescription(/#|\$/);
    expect(
      within(textBox().closest("form") as HTMLElement).queryByText(
        /type #|\$ to mention/i,
      ),
    ).toBeNull();
  });
});
