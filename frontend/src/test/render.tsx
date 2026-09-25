import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

/**
 * The shared render helper every unit's tests use.
 *
 * It puts both contexts a view can reasonably expect in scope — react-query and
 * a router — so a component that calls `useQuery` or `useNavigate` does not fail
 * with a context error that says nothing about the actual test.
 */

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  /** Where the memory router starts. */
  route?: string;
  /** Override the per-render client (rarely needed; seeding a cache is the usual reason). */
  queryClient?: QueryClient;
}

/**
 * Retries off, on purpose: react-query's default of three attempts with backoff
 * turns a test that asserts an error state into a test that times out.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  // A fresh client per render by default: a shared one leaks cached data between
  // tests, which is the green-because-the-previous-test-populated-the-cache
  // failure.
  const { route = "/", queryClient = createTestQueryClient(), ...renderOptions } = options;

  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Providers, ...renderOptions });
}
