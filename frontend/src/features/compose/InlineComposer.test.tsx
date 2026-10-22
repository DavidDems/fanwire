/**
 * FRONTEND-013 criteria 1 and 9 for the thread's reply box.
 *
 * `InlineComposer` is for replies only, and POSTS-005 refuses a `data_link`
 * on a reply (`data_link_on_reply`), so it offers no "Attach stats". It is
 * built from the same parts as `/compose`, so it loses the `#`/`$` dropdown
 * with it: typing a trigger fetches nothing, and a reply goes out without a
 * `data_link` key at all — `features/thread/ThreadModal.test.tsx` pins the
 * reply body with `toEqual`, so a `data_link: null` would break it.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import { queryAttachStatsButton } from "../../test/attach";
import { renderWithAuth } from "../../test/auth";
import {
  createPost,
  recordRequests,
  type RequestRecorder,
} from "../../test/compose";
import { server } from "../../test/server";
import { ComposePage } from "./ComposePage";
import { InlineComposer } from "./InlineComposer";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];

let recorder: RequestRecorder | null = null;

afterEach(() => {
  recorder?.stop();
  recorder = null;
});

function renderReplyBox() {
  renderWithAuth(
    <InlineComposer parentPostId={101} parentUsername="raptorsfan" />,
  );
  return userEvent.setup();
}

function replyBox(): HTMLElement {
  return screen.getByRole("textbox", { name: /your reply/i });
}

describe("the reply box", () => {
  it("offers no Attach stats", async () => {
    // Against the page that does have it, so the absence means something.
    const page = renderWithAuth(<ComposePage />, { route: "/compose" });
    expect(
      await screen.findByRole("button", { name: /^attach stats$/i }),
    ).toBeInTheDocument();
    page.unmount();

    renderReplyBox();

    expect(
      await screen.findByRole("textbox", { name: /your reply/i }),
    ).toBeInTheDocument();
    expect(queryAttachStatsButton()).toBeNull();
    expect(
      screen.queryByRole("region", { name: /^attached stats$/i }),
    ).toBeNull();
  });

  it("fetches nothing when # or $ is typed, and offers no Undo mention", async () => {
    recorder = recordRequests();
    const user = renderReplyBox();

    await user.type(replyBox(), "Called it #12 and $TO");
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(recorder.paths()).toEqual([]);
    expect(screen.queryByRole("region", { name: /suggestions/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });

  it("sends a typed #GameId123 as plain text, with no data_link key", async () => {
    const bodies: CreatePostRequest[] = [];
    server.use(createPost({ onRequest: (body) => bodies.push(body) }));
    recorder = recordRequests();
    const user = renderReplyBox();

    await user.type(replyBox(), "Called it #GameId123");
    await user.click(screen.getByRole("button", { name: "Reply" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(
      recorder.paths().filter((path) => !path.endsWith("/posts")),
      "the only request is the reply itself",
    ).toEqual([]);
    expect(bodies[0].text).toBe("Called it #GameId123");
    expect(Object.keys(bodies[0])).not.toContain("data_link");
  });
});
