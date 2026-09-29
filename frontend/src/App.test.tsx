/**
 * FRONTEND-001 — the app shell, mounted the way `main.tsx` mounts it.
 *
 * `routes.test.tsx` pins the route table on its own, with a memory router.
 * This file pins the other half: that `App` actually wires that table up, so
 * rendering `<App />` at the browser's current location produces the feed view
 * rather than an empty document.
 *
 * Only one render happens here, deliberately. `createBrowserRouter` captures
 * the location when the router is created, which is usually module scope — so
 * pushing a new path and re-rendering `<App />` would silently keep showing the
 * first route. Per-route assertions belong in `routes.test.tsx`, which does not
 * have that problem.
 *
 * The empty-feed handler below is here because the default path *is* the feed,
 * and `FRONTEND-005` turns that view into one that reads `GET /feed` when it
 * mounts. This file is outside that unit's `allowed_paths`, so the handler it
 * needs has to be installed by somebody who may write here. Nothing asserts on
 * it: what this file pins is that `App` wires the route table up at all, and an
 * empty feed is the quietest answer that lets it.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { server, type GetResponseBody } from "./test/server";

// `globals: false`, so Testing Library never registers its own auto-cleanup.
afterEach(cleanup);

beforeEach(() => {
  server.use(
    http.get("*/feed", () =>
      HttpResponse.json<GetResponseBody<"/feed">>({ items: [], next_before_id: null }),
    ),
  );
});

describe("App", () => {
  it("mounts the router and renders the feed view at the default path", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: /feed/i })).toBeInTheDocument();
  });

  it("renders the page content inside a main landmark", async () => {
    render(<App />);

    await screen.findByRole("heading", { name: /feed/i });
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
