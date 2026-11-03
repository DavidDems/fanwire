import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useLocation } from "react-router-dom";

import {
  FakeAuthService,
  profileFound,
  renderWithAuth,
  testSession,
} from "../../test/auth";
import { stubImages, stubIntersectionObserver } from "../../test/card-ready";
import {
  likeStub,
  repostStub,
  testMediaItem,
  testPostView,
} from "../../test/feed";
import { historyStub, type HistoryTab } from "../../test/history";
import { server } from "../../test/server";
import { HistoryPage } from "./HistoryPage";

function Address() {
  const location = useLocation();
  return (
    <output aria-label="Address">{location.pathname + location.search}</output>
  );
}

function renderHistory(route = "/history") {
  return renderWithAuth(
    <>
      <HistoryPage />
      <Address />
    </>,
    {
      route,
      authService: new FakeAuthService({ session: testSession() }),
    },
  );
}

beforeEach(() => {
  server.use(profileFound());
  stubImages({ autoLoad: true });
  stubIntersectionObserver();
});

describe("History", () => {
  it("holds an image post until its card can appear complete", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const api = historyStub({
      posts: [
        {
          items: [
            testPostView({
              text: "a whole history card",
              media: [testMediaItem()],
            }),
          ],
          next_cursor: null,
        },
      ],
    });
    server.use(api.handler);
    renderHistory();
    await waitFor(() => expect(images.requested.length).toBeGreaterThan(0));
    expect(screen.queryByText("a whole history card")).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
    await images.load(images.requested[0]);
    await screen.findByText("a whole history card");
    expect(
      within(screen.getByRole("article")).getAllByRole("img").length,
    ).toBeGreaterThan(0);
  });

  it.each(["posts", "replies", "likes", "reposts"] as const)(
    "reads the URL's %s tab and renders the existing complete post card",
    async (tab) => {
      const post = testPostView({ text: `${tab} activity` });
      const api = historyStub({
        [tab]: [{ items: [post], next_cursor: null }],
      });
      server.use(api.handler);
      renderHistory(`/history?tab=${tab}`);
      expect(
        await screen.findByRole("heading", { name: "History", level: 1 }),
      ).toBeInTheDocument();
      const label = tab[0].toUpperCase() + tab.slice(1);
      expect(screen.getByRole("tab", { name: label })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await screen.findByText(`${tab} activity`);
      const card = screen.getByRole("article");
      expect(
        within(card).getByRole("button", { name: "Like" }),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("button", { name: "Repost" }),
      ).toBeInTheDocument();
      expect(api.calls).toHaveLength(1);
      expect(api.calls[0]).toMatchObject({ tab, cursor: null });
      expect(api.calls[0].authorization).toMatch(/^Bearer /);
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    },
  );

  it.each(["/history", "/history?tab=unknown"])(
    "defaults %s to Posts",
    async (route) => {
      const api = historyStub();
      server.use(api.handler);
      renderHistory(route);
      await waitFor(() => expect(api.calls).toHaveLength(1));
      expect(api.calls[0].tab).toBe("posts");
      expect(screen.getByRole("tab", { name: "Posts" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    },
  );

  it("updates URL state, keeps each tab cached and gives every empty tab its own plain message", async () => {
    const api = historyStub();
    server.use(api.handler);
    renderHistory();
    const messages = new Set<string>();
    for (const tab of ["Posts", "Replies", "Likes", "Reposts"]) {
      await userEvent.click(screen.getByRole("tab", { name: tab }));
      await waitFor(() =>
        expect(api.calls.some((call) => call.tab === tab.toLowerCase())).toBe(
          true,
        ),
      );
      const panel = screen.getByRole("tabpanel");
      await waitFor(() =>
        expect(panel.textContent).toMatch(/no |nothing|yet/i),
      );
      messages.add(panel.textContent ?? "");
      if (tab !== "Posts")
        expect(screen.getByLabelText("Address")).toHaveTextContent(
          `tab=${tab.toLowerCase()}`,
        );
    }
    expect(messages.size).toBe(4);
    await userEvent.click(screen.getByRole("tab", { name: "Posts" }));
    await userEvent.click(screen.getByRole("tab", { name: "Likes" }));
    expect(api.calls.map((call) => call.tab)).toEqual([
      "posts",
      "replies",
      "likes",
      "reposts",
    ]);
  });

  it("uses the opaque cursor, appends cards, then removes Load more on the final page", async () => {
    const api = historyStub({
      posts: [
        {
          items: [testPostView({ id: 101, text: "first history page" })],
          next_cursor: "opaque-next",
        },
        {
          items: [testPostView({ id: 102, text: "second history page" })],
          next_cursor: null,
        },
      ],
    });
    server.use(api.handler);
    renderHistory();
    await screen.findByText("first history page");
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("second history page");
    expect(screen.getByText("first history page")).toBeInTheDocument();
    expect(api.calls.map((call) => call.cursor)).toEqual([null, "opaque-next"]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("offers Retry with the shared alert after a failed read", async () => {
    const api = historyStub({
      posts: [
        {
          items: [testPostView({ text: "recovered history" })],
          next_cursor: null,
        },
      ],
    });
    api.fail();
    server.use(api.handler);
    renderHistory();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not|unable|try again/i,
    );
    api.fail(false);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("recovered history");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("supports arrows, Home and End using the shared tab keyboard pattern", async () => {
    server.use(historyStub().handler);
    renderHistory();
    const posts = await screen.findByRole("tab", { name: "Posts" });
    posts.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Replies" })).toHaveFocus();
    expect(screen.getByLabelText("Address")).toHaveTextContent("tab=replies");
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Reposts" })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(posts).toHaveFocus();
  });

  it.each(["likes", "reposts"] as const)(
    "undoes %s optimistically and restores it on failure",
    async (tab: HistoryTab) => {
      const post = testPostView({
        text: "toggle history",
        liked_by_viewer: true,
        reposted_by_viewer: true,
      });
      const api = historyStub({
        [tab]: [{ items: [post], next_cursor: null }],
      });
      const mutation = tab === "likes" ? likeStub() : repostStub();
      const release = mutation.hold();
      server.use(api.handler, ...mutation.handlers);
      renderHistory(`/history?tab=${tab}`);
      await screen.findByText("toggle history");
      const control = within(screen.getByRole("article")).getByRole("button", {
        name: tab === "likes" ? "Like" : "Repost",
      });
      expect(control).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(control);
      await waitFor(() => expect(mutation.calls).toHaveLength(1));
      expect(mutation.calls[0]).toMatchObject({
        method: "DELETE",
        postId: post.id,
      });
      expect(control).toHaveAttribute("aria-pressed", "false");
      if (tab === "likes") (mutation as ReturnType<typeof likeStub>).fail();
      else (mutation as ReturnType<typeof repostStub>).fail(500);
      release();
      await waitFor(() =>
        expect(control).toHaveAttribute("aria-pressed", "true"),
      );
      expect(await screen.findByRole("alert")).toBeInTheDocument();
    },
  );
});
