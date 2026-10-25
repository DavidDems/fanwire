/**
 * FRONTEND-020 — the image check: choose a file, wait on the image itself, and
 * it is attached; or it is removed with one red line.
 *
 * What is pinned (task.json, "Image check" and "Refusal"):
 *
 * - **The tile.** From the choice, through the bucket upload and the check
 *   alike, the file's name in a tile, with a `role="status"` line reading
 *   "Checking the image…". Post (and the reply box's Reply) is disabled while
 *   it is there.
 * - **Processed attaches by itself**: the served thumbnail replaces the tile,
 *   the media id is in the draft with no second press, and "Remove image"
 *   (CircleXIcon) takes it out again.
 * - **Every refusal is one line**, exactly "The image you attached is too large
 *   or cannot be accepted", an alert with a CircleXIcon, the tile gone and
 *   nothing attached: a type the client refuses, a file over the ticket's
 *   `max_bytes`, `rejected`, or no `processed` within 30 s of the bucket
 *   upload finishing. Choosing another file clears it. A failure to reach the
 *   API or the bucket keeps "We could not upload that image. Please try
 *   again."
 * - **The clock.** One poll a second from the end of the upload; at the bound
 *   one last poll before refusing (and a `processed` answer to it attaches,
 *   even when the regular poll was paused in a hidden tab, R17); none after
 *   the bound, a terminal status, or the composer's unmount; at most 31 polls;
 *   and no clock at all while the upload itself is still in flight.
 *
 * Fake timers drive the clock (`Date` included, so the doubles in
 * `src/test/compose-modal.tsx` answer by the time, not the call number); the
 * network still settles on real turns of the event loop between steps.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "../../api/schema";
import { CircleXIcon } from "../../components/ui/icons";
import { config } from "../../config";
import { renderWithAuth } from "../../test/auth";
import {
  TEST_MEDIA_ID,
  TEST_THUMBNAIL_KEY,
  createPost,
  testFile,
  testUpload,
  uploadTicket,
} from "../../test/compose";
import {
  CHECK_BOUND_MS,
  IMAGE_CHECKING,
  IMAGE_REFUSED,
  IMAGE_UPLOAD_FAILED,
  drawsIcon,
  heldBucket,
  imageFileInput,
  mediaPoll,
  textOf,
  type HeldBucket,
  type MediaPoll,
} from "../../test/compose-modal";
import { server } from "../../test/server";
import { ComposeMediator } from "./ComposeMediator";
import { ComposePage } from "./ComposePage";
import { InlineComposer } from "./InlineComposer";
import { MediaWidget } from "./MediaWidget";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

/** Let the network and React settle on real turns of the event loop. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    });
  }
}

/** Move the fake clock on by `ms`, in small steps, settling between them. */
async function advance(ms: number): Promise<void> {
  let left = ms;
  while (left > 0) {
    const step = Math.min(100, left);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
    await settle();
    left -= step;
  }
}

/** Choose `file` in the composer's hidden input, as the paperclip's chooser does. */
async function choose(file: File = testFile()): Promise<void> {
  fireEvent.change(imageFileInput(), { target: { files: [file] } });
  await settle();
}

interface Pipeline {
  bucket: HeldBucket;
  poll: MediaPoll;
  tickets: () => number;
}

/**
 * The ticket, the bucket and the poll. `processedAfter` is how long after the
 * upload ended the pipeline answers `processed` (`Infinity`: never); a
 * `rejectedAfter` answers `rejected` from then on instead.
 */
function pipeline(
  options: { processedAfter?: number; rejectedAfter?: number } = {},
): Pipeline {
  const { processedAfter = Infinity, rejectedAfter = Infinity } = options;
  let tickets = 0;
  const bucket = heldBucket();
  const poll = mediaPoll((now) => {
    const elapsed = now - (bucket.endedAt ?? now);
    if (elapsed >= rejectedAfter) return "rejected";
    if (elapsed >= processedAfter) return "processed";
    return "scanning";
  });
  server.use(
    uploadTicket({ onRequest: () => (tickets += 1) }),
    bucket.handler,
    poll.handler,
  );
  return { bucket, poll, tickets: () => tickets };
}

function renderWidget() {
  const mediator = new ComposeMediator();
  const view = renderWithAuth(<MediaWidget mediator={mediator} />);
  return { mediator, ...view };
}

function checkingStatus(): HTMLElement | null {
  return (
    screen
      .queryAllByRole("status")
      .find((status) => textOf(status) === IMAGE_CHECKING) ?? null
  );
}

function refusal(): HTMLElement | null {
  return (
    screen
      .queryAllByRole("alert")
      .find((alert) => textOf(alert) === IMAGE_REFUSED) ?? null
  );
}

function expectRefusedOnce(): void {
  const alerts = screen
    .queryAllByRole("alert")
    .filter((alert) => textOf(alert) !== "");
  expect(alerts.map(textOf)).toEqual([IMAGE_REFUSED]);
  expect(
    drawsIcon(alerts[0], CircleXIcon),
    "the refusal line carries one aria-hidden CircleXIcon",
  ).toBe(true);
}

/** The thumbnail, once processed: the served image, never a blob URL. */
function thumbnail(): HTMLElement | null {
  return (
    screen
      .queryAllByRole("img")
      .find((image) =>
        (image.getAttribute("src") ?? "").includes(TEST_THUMBNAIL_KEY),
      ) ?? null
  );
}

describe("the tile while the image is checked", () => {
  it("shows the file name and 'Checking the image…' from the choice, through the upload", async () => {
    const { bucket } = pipeline();
    bucket.hold();
    renderWidget();

    await choose(testFile({ name: "courtside.jpg" }));

    expect(screen.getByText(/courtside\.jpg/)).toBeInTheDocument();
    expect(checkingStatus(), "the status line while uploading").not.toBeNull();
    expect(thumbnail()).toBeNull();
    expect(refusal()).toBeNull();

    bucket.release();
    await advance(2_000);

    expect(screen.getByText(/courtside\.jpg/)).toBeInTheDocument();
    expect(
      checkingStatus(),
      "the same line while it is checked",
    ).not.toBeNull();
  });

  it("offers no Attach press at any point", async () => {
    pipeline({ processedAfter: 3_000 });
    renderWidget();

    await choose();
    expect(screen.queryByRole("button", { name: /^attach$/i })).toBeNull();
    await advance(5_000);
    expect(screen.queryByRole("button", { name: /^attach$/i })).toBeNull();
  });
});

describe("a processed image attaches by itself", () => {
  it("replaces the tile with the served thumbnail and puts the id in the draft, with no second press", async () => {
    pipeline({ processedAfter: 2_000 });
    const { mediator } = renderWidget();

    await choose();
    expect(mediator.getDraft().mediaIds).toEqual([]);
    await advance(4_000);

    const image = thumbnail();
    expect(image, "the served thumbnail").not.toBeNull();
    expect(image?.getAttribute("src")).toContain(config.mediaBaseUrl);
    expect(image).toHaveAccessibleName();
    expect(checkingStatus()).toBeNull();
    expect(mediator.getDraft().mediaIds).toEqual([TEST_MEDIA_ID]);
    expect(refusal()).toBeNull();
  });

  it("offers 'Remove image', a CircleXIcon button, which takes it out of the draft", async () => {
    pipeline({ processedAfter: 0 });
    const { mediator } = renderWidget();

    await choose();
    await advance(2_000);
    const remove = screen.getByRole("button", { name: "Remove image" });
    expect(drawsIcon(remove, CircleXIcon)).toBe(true);

    fireEvent.click(remove);
    await settle();

    expect(mediator.getDraft().mediaIds).toEqual([]);
    expect(thumbnail()).toBeNull();
  });

  it("stops polling once processed", async () => {
    const { poll } = pipeline({ processedAfter: 2_000 });
    renderWidget();

    await choose();
    await advance(4_000);
    const polls = poll.times.length;
    await advance(10_000);

    expect(poll.times).toHaveLength(polls);
  });
});

describe("the poll", () => {
  it("asks once a second from the end of the upload", async () => {
    const { bucket, poll } = pipeline();
    renderWidget();

    await choose();
    await advance(5_000);

    const end = bucket.endedAt;
    expect(end).not.toBeNull();
    const within5s = poll.times.filter((time) => time - (end ?? 0) <= 5_000);
    expect(within5s.length).toBeGreaterThanOrEqual(4);
    expect(within5s.length).toBeLessThanOrEqual(6);
    for (let index = 1; index < poll.times.length; index += 1) {
      expect(
        poll.times[index] - poll.times[index - 1],
        "polls are a second apart",
      ).toBeGreaterThanOrEqual(900);
    }
  });

  it("starts no clock while the upload is still in flight", async () => {
    const { bucket, poll } = pipeline({ processedAfter: 3_000 });
    bucket.hold();
    const { mediator } = renderWidget();

    await choose();
    await advance(45_000);

    expect(refusal(), "a slow upload is not refused").toBeNull();
    expect(checkingStatus()).not.toBeNull();
    expect(poll.times).toEqual([]);

    bucket.release();
    await advance(5_000);

    expect(refusal()).toBeNull();
    expect(mediator.getDraft().mediaIds).toEqual([TEST_MEDIA_ID]);
  });

  it("makes no poll after the composer closes", async () => {
    const { poll } = pipeline();
    const { unmount } = renderWidget();

    await choose();
    await advance(3_000);
    unmount();
    const polls = poll.times.length;
    await advance(60_000);

    expect(poll.times).toHaveLength(polls);
  });
});

describe("the 30 s bound", () => {
  it("refuses at the bound, after one last poll, and polls no more", async () => {
    const { bucket, poll, tickets } = pipeline();
    const { mediator } = renderWidget();

    await choose(testFile({ name: "slow.jpg" }));
    await advance(CHECK_BOUND_MS - 500);

    expect(refusal(), "not before the bound").toBeNull();
    expect(checkingStatus()).not.toBeNull();

    await advance(1_500);

    expectRefusedOnce();
    expect(screen.queryByText(/slow\.jpg/), "the tile is gone").toBeNull();
    expect(checkingStatus()).toBeNull();
    expect(mediator.getDraft().mediaIds).toEqual([]);

    const end = bucket.endedAt ?? 0;
    const last = poll.times[poll.times.length - 1];
    expect(last - end, "a last poll at the bound").toBeGreaterThanOrEqual(
      CHECK_BOUND_MS - 100,
    );
    expect(poll.times.length).toBeLessThanOrEqual(31);

    const polls = poll.times.length;
    await advance(60_000);
    expect(poll.times, "none after the bound").toHaveLength(polls);

    // One image: one ticket, one bucket upload, at most 31 polls.
    expect(tickets()).toBe(1);
    expect(bucket.calls).toBe(1);
  });

  it("attaches an image that the last poll at the bound finds processed", async () => {
    pipeline({ processedAfter: CHECK_BOUND_MS - 1 });
    const { mediator } = renderWidget();

    await choose();
    await advance(CHECK_BOUND_MS + 2_000);

    expect(refusal()).toBeNull();
    expect(mediator.getDraft().mediaIds).toEqual([TEST_MEDIA_ID]);
    expect(thumbnail()).not.toBeNull();
  });

  it("does not refuse a processed image whose regular poll was paused in a hidden tab (R17)", async () => {
    const { poll } = pipeline({ processedAfter: 5_000 });
    const { mediator } = renderWidget();

    await choose();
    await advance(500);
    act(() => {
      focusManager.setFocused(false);
    });
    await advance(CHECK_BOUND_MS + 2_000);

    expect(refusal()).toBeNull();
    expect(mediator.getDraft().mediaIds).toEqual([TEST_MEDIA_ID]);
    expect(poll.times.length).toBeLessThanOrEqual(31);
  });
});

describe("every refusal is the one red line", () => {
  it("a type the client refuses: no request at all", async () => {
    const { bucket, poll, tickets } = pipeline();
    const { mediator } = renderWidget();

    await choose(testFile({ name: "notes.pdf", type: "application/pdf" }));

    expectRefusedOnce();
    expect(screen.queryByText(/notes\.pdf/)).toBeNull();
    expect(tickets()).toBe(0);
    expect(bucket.calls).toBe(0);
    expect(poll.times).toEqual([]);
    expect(mediator.getDraft().mediaIds).toEqual([]);
  });

  it("an SVG is refused the same way", async () => {
    const { tickets } = pipeline();
    renderWidget();

    await choose(testFile({ name: "logo.svg", type: "image/svg+xml" }));

    expectRefusedOnce();
    expect(tickets()).toBe(0);
  });

  it("a file over the ticket's max_bytes: the ticket, and no upload", async () => {
    let tickets = 0;
    const bucket = heldBucket();
    server.use(
      uploadTicket({
        response: testUpload({ max_bytes: 64 }),
        onRequest: () => (tickets += 1),
      }),
      bucket.handler,
    );
    const { mediator } = renderWidget();

    await choose(testFile({ name: "huge.jpg", bytes: 128 }));
    await advance(500);

    expectRefusedOnce();
    expect(screen.queryByText(/huge\.jpg/)).toBeNull();
    expect(tickets).toBe(1);
    expect(bucket.calls).toBe(0);
    expect(mediator.getDraft().mediaIds).toEqual([]);
  });

  it("rejected by the pipeline: refused, and the poll stops", async () => {
    const { poll } = pipeline({ rejectedAfter: 2_000 });
    const { mediator } = renderWidget();

    await choose(testFile({ name: "bad.jpg" }));
    await advance(4_000);

    expectRefusedOnce();
    expect(screen.queryByText(/bad\.jpg/)).toBeNull();
    expect(mediator.getDraft().mediaIds).toEqual([]);
    const polls = poll.times.length;
    await advance(10_000);
    expect(poll.times).toHaveLength(polls);
  });

  it("choosing another file clears the line", async () => {
    let refuse = true;
    const bucket = heldBucket();
    const poll = mediaPoll(() => (refuse ? "rejected" : "processed"));
    server.use(uploadTicket(), bucket.handler, poll.handler);
    const { mediator } = renderWidget();

    await choose();
    await advance(2_000);
    expectRefusedOnce();

    refuse = false;
    await choose(testFile({ name: "second.jpg" }));

    expect(refusal(), "cleared on the choice").toBeNull();
    await advance(2_000);
    expect(refusal()).toBeNull();
    expect(mediator.getDraft().mediaIds).toEqual([TEST_MEDIA_ID]);
  });
});

describe("a failure to reach the API or the bucket keeps today's line", () => {
  it("the ticket request failing", async () => {
    server.use(uploadTicket({ status: 500 }));
    const { mediator } = renderWidget();

    await choose();
    await advance(500);

    const alerts = screen.getAllByRole("alert").map(textOf);
    expect(alerts).toContain(IMAGE_UPLOAD_FAILED);
    expect(alerts).not.toContain(IMAGE_REFUSED);
    expect(mediator.getDraft().mediaIds).toEqual([]);
  });

  it("the bucket upload failing", async () => {
    const { bucket, poll } = pipeline();
    bucket.answerWith(500);
    renderWidget();

    await choose();
    await advance(500);

    const alerts = screen.getAllByRole("alert").map(textOf);
    expect(alerts).toContain(IMAGE_UPLOAD_FAILED);
    expect(alerts).not.toContain(IMAGE_REFUSED);
    expect(poll.times).toEqual([]);
  });
});

describe("Post waits for the check (ComposePage)", () => {
  it("is disabled while the image is checked, and posts it once processed with no second press", async () => {
    const bodies: CreatePostRequest[] = [];
    pipeline({ processedAfter: 3_000 });
    server.use(createPost({ onRequest: (body) => bodies.push(body) }));
    renderWithAuth(<ComposePage />, { route: "/compose" });

    fireEvent.change(screen.getByRole("textbox", { name: /post/i }), {
      target: { value: "Raptors in 6" },
    });
    await settle();
    const post = screen.getByRole("button", { name: /^post$/i });
    expect(post).toBeEnabled();

    await choose();
    expect(post, "disabled while checking").toBeDisabled();
    await advance(1_500);
    expect(post).toBeDisabled();

    await advance(3_000);
    expect(post).toBeEnabled();
    fireEvent.click(post);
    await advance(200);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      text: "Raptors in 6",
      media_ids: [TEST_MEDIA_ID],
    });
  });

  it("is enabled again after a refusal, without the image", async () => {
    pipeline({ rejectedAfter: 1_000 });
    renderWithAuth(<ComposePage />, { route: "/compose" });

    fireEvent.change(screen.getByRole("textbox", { name: /post/i }), {
      target: { value: "Raptors in 6" },
    });
    await choose();
    expect(screen.getByRole("button", { name: /^post$/i })).toBeDisabled();
    await advance(3_000);

    expectRefusedOnce();
    expect(screen.getByRole("button", { name: /^post$/i })).toBeEnabled();
  });
});

describe("the thread's reply box takes the same image flow (InlineComposer)", () => {
  function renderReplyBox() {
    return renderWithAuth(
      <InlineComposer parentPostId={101} parentUsername="raptorsfan" />,
    );
  }

  it("shows the tile, keeps Reply disabled while checking, and attaches by itself", async () => {
    const bodies: CreatePostRequest[] = [];
    pipeline({ processedAfter: 2_000 });
    server.use(createPost({ onRequest: (body) => bodies.push(body) }));
    const { container } = renderReplyBox();

    fireEvent.change(screen.getByRole("textbox", { name: /your reply/i }), {
      target: { value: "Called it" },
    });
    await settle();
    const reply = screen.getByRole("button", { name: "Reply" });

    fireEvent.change(imageFileInput(container), {
      target: { files: [testFile({ name: "reply.jpg" })] },
    });
    await settle();
    expect(screen.getByText(/reply\.jpg/)).toBeInTheDocument();
    expect(checkingStatus()).not.toBeNull();
    expect(reply).toBeDisabled();

    await advance(4_000);
    expect(thumbnail()).not.toBeNull();
    expect(reply).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^attach$/i })).toBeNull();

    fireEvent.click(reply);
    await advance(200);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      is_reply: true,
      parent_post_id: 101,
      media_ids: [TEST_MEDIA_ID],
    });
  });

  it("refuses at the bound with the same one line", async () => {
    pipeline();
    const { container } = renderReplyBox();

    fireEvent.change(imageFileInput(container), {
      target: { files: [testFile()] },
    });
    await settle();
    await advance(CHECK_BOUND_MS + 1_500);

    const form = container.querySelector("form") as HTMLElement;
    expect(
      within(form)
        .getAllByRole("alert")
        .map(textOf)
        .filter((text) => text !== ""),
    ).toEqual([IMAGE_REFUSED]);
  });
});
