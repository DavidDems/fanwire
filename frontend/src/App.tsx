import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

import { routes } from "./routes/routes";

/**
 * The application shell: the route table from `routes/`, mounted in a browser
 * router, inside the one react-query client the app shares.
 *
 * Both are built at module scope on purpose. `createBrowserRouter` reads the
 * browser's location when it is created, and a `QueryClient` rebuilt on every
 * render would throw the cache away each time.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A feed page that is seconds old is not worth a refetch on every focus
      // change; anything that must be fresh asks for it at the query.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createBrowserRouter(routes);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
