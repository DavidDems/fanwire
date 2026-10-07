import type { RouteObject } from "react-router-dom";

import { ConfirmPage } from "../auth/ConfirmPage";
import { ForgotPasswordPage } from "../auth/ForgotPasswordPage";
import { ProfileSetupPage } from "../auth/ProfileSetupPage";
import { SignInPage } from "../auth/SignInPage";
import { SignUpPage } from "../auth/SignUpPage";
import { ComposePage } from "../features/compose/ComposePage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { SearchPage } from "../features/search/SearchPage";
import { AppLayout } from "./AppLayout";
import { RequireAuth, RequireNewProfile } from "./guards";
import { HomeView } from "./HomeView";
import { NotFoundView } from "./views";

/**
 * The route table, as data rather than JSX elements, so it can be handed to
 * `createBrowserRouter` in the app and `createMemoryRouter` in a test without
 * either one re-declaring it.
 *
 * Every route lives under `AppLayout`, including the catch-all: a wrong address
 * still gets the navigation that lets you leave it.
 *
 * Guards are applied here rather than inside each view, so that "which routes
 * need a session" is one readable list instead of a property of nine files.
 * The public routes are public by decision ([[0x01-users]]: the guest feed and
 * profile views are read paths) — a guard on either of those is a regression.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppLayout />,
    children: [
      // FRONTEND-005's feed under FRONTEND-007's search bar. Public, and the
      // app's index: the guest feed is a read path by decision ([[0x06-feed]]
      // Security).
      { index: true, element: <HomeView /> },
      {
        path: "compose",
        element: (
          <RequireAuth>
            <ComposePage />
          </RequireAuth>
        ),
      },
      {
        path: "notifications",
        element: (
          <RequireAuth>
            <NotificationsPage />
          </RequireAuth>
        ),
      },
      // FRONTEND-007's page. Public: search is a read path ([[0x07-search]]).
      { path: "search", element: <SearchPage /> },
      // FRONTEND-003's page. Still public, and still one route: the id in the
      // path is what selects the own-profile variant from the public one.
      { path: "profile/:userId", element: <ProfilePage /> },

      // FRONTEND-002's pages.
      { path: "sign-in", element: <SignInPage /> },
      { path: "sign-up", element: <SignUpPage /> },
      { path: "confirm", element: <ConfirmPage /> },
      { path: "forgot-password", element: <ForgotPasswordPage /> },
      {
        // Reachable only by a signed-in visitor who has no profile row yet —
        // the guard sends everyone else to the feed.
        path: "create-profile",
        element: (
          <RequireNewProfile>
            <ProfileSetupPage />
          </RequireNewProfile>
        ),
      },

      // The app's own not-found view, not react-router's error boundary.
      { path: "*", element: <NotFoundView /> },
    ],
  },
];
