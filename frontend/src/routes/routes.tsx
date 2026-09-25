import type { RouteObject } from "react-router-dom";

import { AppLayout } from "./AppLayout";
import {
  ComposeView,
  ConfirmView,
  FeedView,
  ForgotPasswordView,
  NotFoundView,
  NotificationsView,
  ProfileView,
  SearchView,
  SignInView,
  SignUpView,
} from "./views";

/**
 * The route table, as data rather than JSX elements, so it can be handed to
 * `createBrowserRouter` in the app and `createMemoryRouter` in a test without
 * either one re-declaring it.
 *
 * Every route lives under `AppLayout`, including the catch-all: a wrong address
 * still gets the navigation that lets you leave it.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <FeedView /> },
      { path: "compose", element: <ComposeView /> },
      { path: "notifications", element: <NotificationsView /> },
      { path: "search", element: <SearchView /> },
      { path: "profile/:userId", element: <ProfileView /> },

      // FRONTEND-002's pages.
      { path: "sign-in", element: <SignInView /> },
      { path: "sign-up", element: <SignUpView /> },
      { path: "confirm", element: <ConfirmView /> },
      { path: "forgot-password", element: <ForgotPasswordView /> },

      // The app's own not-found view, not react-router's error boundary.
      { path: "*", element: <NotFoundView /> },
    ],
  },
];
