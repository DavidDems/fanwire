import type { RouteObject } from "react-router-dom";

import { ConfirmPage } from "../auth/ConfirmPage";
import { ForgotPasswordPage } from "../auth/ForgotPasswordPage";
import { ProfileSetupPage } from "../auth/ProfileSetupPage";
import { SignInPage } from "../auth/SignInPage";
import { SignUpPage } from "../auth/SignUpPage";
import { AppLayout } from "./AppLayout";
import { RequireAuth, RequireNewProfile } from "./guards";
import {
  ComposeView,
  FeedView,
  NotFoundView,
  NotificationsView,
  ProfileView,
  SearchView,
} from "./views";

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
      { index: true, element: <FeedView /> },
      {
        path: "compose",
        element: (
          <RequireAuth>
            <ComposeView />
          </RequireAuth>
        ),
      },
      {
        path: "notifications",
        element: (
          <RequireAuth>
            <NotificationsView />
          </RequireAuth>
        ),
      },
      { path: "search", element: <SearchView /> },
      { path: "profile/:userId", element: <ProfileView /> },

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
