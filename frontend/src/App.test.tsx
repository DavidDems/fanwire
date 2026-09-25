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
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";

// `globals: false`, so Testing Library never registers its own auto-cleanup.
afterEach(cleanup);

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
