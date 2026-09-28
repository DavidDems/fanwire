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
 * touch. Games and teams are fetched when the user types `#` or `$`, and at no
 * other time.
 *
 * **Draft preservation is the criterion most likely to be faked green**, because
 * the happy path is what gets clicked. A failed `POST /posts` keeps the text
 * *and* the attachment *and* says what happened *and* lets the user try again —
 * all four, or the user loses what they typed on a 500.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import { renderWithAuth } from "../../test/auth";
import {
  TEST_MEDIA_ID,
  createPost,
  gamesAre,
  mediaStatuses,
  recordRequests,
  s3Upload,
  testFile,
  uploadTicket,
  type RequestRecorder,
} from "../../test/compose";
import { server } from "../../test/server";
import { ComposePage } from "./ComposePage";
import { QUICK_POST_TEMPLATES } from "./PostTemplate";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];

let recorder: RequestRecorder | null = null;

afterEach(() => {
  recorder?.stop();
  recorder = null;
});

function renderComposer() {
  renderWithAuth(<ComposePage />);
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
  server.use(uploadTicket(), s3Upload(), mediaStatuses({ statuses: ["processed"] }));
}

async function attachAProcessedImage(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText(/image/i), testFile());
  const attach = await screen.findByRole("button", { name: /attach/i });
  await waitFor(() => expect(attach).toBeEnabled());
  await user.click(attach);
  await screen.findByRole("img");
}

describe("the composer page", () => {
  it("keeps the heading the route table pins", async () => {
    recorder = recordRequests();
    renderComposer();

    expect(await screen.findByRole("heading", { name: /^compose$/i })).toBeInTheDocument();
  });

  it("issues no HTTP request when it mounts", async () => {
    // Games and teams are fetched when the user types `#` or `$`. A query on
    // mount would make `routes.test.tsx` fail with an unhandled request, in a
    // file this unit must leave byte-for-byte unchanged.
    recorder = recordRequests();
    renderComposer();

    await screen.findByRole("heading", { name: /^compose$/i });
    expect(textBox()).toBeInTheDocument();

    expect(recorder.paths()).toEqual([]);
  });

  it("will not submit a draft with neither text nor media", async () => {
    recorder = recordRequests();
    renderComposer();

    await screen.findByRole("heading", { name: /^compose$/i });

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
    expect(screen.queryByRole("img"), "the attachment is cleared too").toBeNull();
  });
});

describe("a failed POST /posts does not cost the user their draft", () => {
  it("keeps the text, keeps the attachment, says what happened and allows a retry", async () => {
    const bodies: CreatePostRequest[] = [];
    mediaUploadSucceeds();
    server.use(createPost({ status: 500, onRequest: (body) => bodies.push(body) }));
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

    await user.click(await screen.findByRole("button", { name: template.name }));

    expect(textBox()).toHaveValue(template.clone().text);
    expect(recorder.paths(), "a template is stored in the app, not fetched").toEqual([]);
  });

  it("leaves the template itself untouched when the draft from it is edited", async () => {
    const user = renderComposer();

    await user.click(await screen.findByRole("button", { name: template.name }));
    await user.type(textBox(), "Raptors by 12");
    await user.click(screen.getByRole("button", { name: template.name }));

    expect(textBox()).toHaveValue(template.clone().text);
  });
});

describe("undo, after live-event data is attached", () => {
  it("offers no undo before anything has been attached", async () => {
    renderComposer();

    await screen.findByRole("heading", { name: /^compose$/i });

    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });

  it("restores the exact draft the mention was inserted into, attachment and all", async () => {
    mediaUploadSucceeds();
    server.use(gamesAre());
    const user = renderComposer();

    await user.type(textBox(), "Raptors win ");
    await attachAProcessedImage(user);
    await user.type(textBox(), "#12");
    await user.click(await screen.findByRole("button", { name: /123/ }));
    await waitFor(() => expect(textBox()).toHaveValue("Raptors win #GameId123 "));

    await user.click(screen.getByRole("button", { name: /undo/i }));

    expect(textBox()).toHaveValue("Raptors win #12");
    expect(screen.getByRole("img"), "undo must not drop the attachment").toBeInTheDocument();
  });
});
