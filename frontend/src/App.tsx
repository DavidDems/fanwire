import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

import { AuthProvider } from "./auth/AuthContext";
import { CognitoAuthService } from "./auth/CognitoAuthService";
import { installTokenProvider } from "./auth/tokenProvider";
import { routes } from "./routes/routes";

/**
 * The application shell: the route table from `routes/`, mounted in a browser
 * router, inside the one react-query client and the one auth session the app
 * shares.
 *
 * All of it is built at module scope on purpose. `createBrowserRouter` reads the
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

/**
 * The one place in the app that chooses an implementation of `AuthService`.
 * Everything else — every page, hook and guard — depends on the interface, and
 * nothing anywhere branches on environment to pick a different one.
 */
const authService = new CognitoAuthService();

// `apiClient`'s token provider reads from the same service the pages use, so a
// sign-in or a sign-out takes effect on the very next request. Installed here,
// once, at module load: `api/client.ts` holds its provider behind a closure
// precisely so this can happen after it was imported.
installTokenProvider(authService);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/*
        Outside the router, deliberately: a session does not belong to a route,
        and the guards inside the table need it to already be resolving by the
        time the first route renders.
      */}
      <AuthProvider authService={authService}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
