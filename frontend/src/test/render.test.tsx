/**
 * FRONTEND-001 acceptance criterion 9 — the shared test render helper.
 *
 * Six units land on this helper. If it does not put both a QueryClientProvider
 * and a router in scope, every one of them re-invents its own wrapper, and the
 * first component that calls `useQuery` or `useNavigate` in a test blows up
 * with a context error that says nothing about the actual failure.
 *
 * "A fresh QueryClient with retries disabled" is the other half. A shared
 * client leaks cached data between tests — the classic green-because-the-
 * previous-test-populated-the-cache failure — and react-query's default of
 * three retries with backoff turns a test that asserts an error state into a
 * test that times out.
 *
 * The probe reads the two contexts through their public hooks, so a missing
 * provider fails here rather than in the unit that lands next.
 */
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "./render";

interface Captured {
  queryClient: QueryClient;
  pathname: string;
}

let captured: Captured | null = null;

function Probe() {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  captured = { queryClient, pathname };
  return <p>probe rendered</p>;
}

// `globals: false`, so Testing Library never registers its own auto-cleanup.
afterEach(() => {
  cleanup();
  captured = null;
});

describe("renderWithProviders", () => {
  it("puts a QueryClientProvider and a router in scope", () => {
    renderWithProviders(<Probe />);

    expect(screen.getByText("probe rendered")).toBeInTheDocument();
    expect(captured?.queryClient).toBeInstanceOf(QueryClient);
    expect(captured?.pathname).toBe("/");
  });

  it("starts the router at the route it is given", () => {
    renderWithProviders(<Probe />, { route: "/profile/42" });

    expect(captured?.pathname).toBe("/profile/42");
  });

  it("disables query retries", () => {
    renderWithProviders(<Probe />);

    expect(captured?.queryClient.getDefaultOptions().queries?.retry).toBe(false);
  });

  it("gives every render its own QueryClient", () => {
    renderWithProviders(<Probe />);
    const first = captured?.queryClient;
    cleanup();

    renderWithProviders(<Probe />);
    const second = captured?.queryClient;

    expect(first).toBeInstanceOf(QueryClient);
    expect(second).not.toBe(first);
  });

  it("returns Testing Library's own render result", () => {
    const result = renderWithProviders(<Probe />);

    expect(typeof result.unmount).toBe("function");
    expect(typeof result.rerender).toBe("function");
  });
});
