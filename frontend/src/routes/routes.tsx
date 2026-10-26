import { lazy } from "react";
import { Navigate, type RouteObject } from "react-router-dom";

import { SearchPage } from "../features/search/SearchPage";
import { DetailModal } from "../features/thread/DetailModal";
import { ThreadModal } from "../features/thread/ThreadModal";
import { AppLayout } from "./AppLayout";
import { BackgroundRoutes, flowOnly } from "./BackgroundRoutes";
import { ComposeModal } from "./ComposeModal";
import { GameDetail, PlayerDetail } from "./details";
import { RequireAuth, RequireNewProfile } from "./guards";
import { HomeView } from "./HomeView";
import { NotFoundView } from "./views";

/*
 * Every page but the first paint loads as its own chunk (FRONTEND-015): the
 * feed, search, the thread modal and the shell stay in the main one (the
 * composer's chunk is loaded by `ComposeModal`, inside its dialog). Each
 * page is a named export, so `lazy` is handed an adapter to a default one.
 * `BackgroundRoutes` holds the one Suspense they wait behind.
 */
const NotificationsPage = lazy(() =>
  import("../features/notifications/NotificationsPage").then((m) => ({
    default: m.NotificationsPage,
  })),
);
const ProfilePage = lazy(() =>
  import("../features/profile/ProfilePage").then((m) => ({
    default: m.ProfilePage,
  })),
);
const GamePage = lazy(() =>
  import("../features/games/GamePage").then((m) => ({ default: m.GamePage })),
);
const PlayerPage = lazy(() =>
  import("../features/players/PlayerPage").then((m) => ({
    default: m.PlayerPage,
  })),
);
const StatsPage = lazy(() =>
  import("../features/stats/StatsPage").then((m) => ({ default: m.StatsPage })),
);
const SeasonsTab = lazy(() =>
  import("../features/stats/SeasonsTab").then((m) => ({
    default: m.SeasonsTab,
  })),
);
const RecordsTab = lazy(() =>
  import("../features/stats/RecordsTab").then((m) => ({
    default: m.RecordsTab,
  })),
);
const PlayersTab = lazy(() =>
  import("../features/stats/PlayersTab").then((m) => ({
    default: m.PlayersTab,
  })),
);
const SignInPage = lazy(() =>
  import("../auth/SignInPage").then((m) => ({ default: m.SignInPage })),
);
const SignUpPage = lazy(() =>
  import("../auth/SignUpPage").then((m) => ({ default: m.SignUpPage })),
);
const ConfirmPage = lazy(() =>
  import("../auth/ConfirmPage").then((m) => ({ default: m.ConfirmPage })),
);
const ForgotPasswordPage = lazy(() =>
  import("../auth/ForgotPasswordPage").then((m) => ({
    default: m.ForgotPasswordPage,
  })),
);
const ProfileSetupPage = lazy(() =>
  import("../auth/ProfileSetupPage").then((m) => ({
    default: m.ProfileSetupPage,
  })),
);

/**
 * The route table, as data rather than JSX elements, so it can be handed to
 * `createBrowserRouter` in the app and `createMemoryRouter` in a test without
 * either one re-declaring it.
 *
 * Every route lives under `AppLayout`, including the catch-all: a wrong address
 * still gets the navigation that lets you leave it.
 *
 * **Two lists: the pages, and what opens over them.** A page fills `main`; an
 * overlay (FRONTEND-010's thread modal at `/posts/:postId`) is rendered over
 * the page the reader opened it from, which stays mounted underneath.
 * `BackgroundRoutes` is what matches both, and why the layout's one child is a
 * splat: react-router's background-location recipe ([[0x08-frontend]]).
 *
 * Guards are applied here rather than inside each view, so that "which routes
 * need a session" is one readable list instead of a property of nine files.
 * The public routes are public by decision ([[0x01-users]]: the guest feed and
 * profile views are read paths) — a guard on either of those is a regression.
 */
const pages: RouteObject[] = [
  // FRONTEND-005's feed under FRONTEND-007's search bar. Public, and the
  // app's index: the guest feed is a read path by decision ([[0x06-feed]]
  // Security).
  { index: true, element: <HomeView /> },
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
  // FRONTEND-008's page. Public: a game is a read path ([[0x02-events]]),
  // and every other feature reaches it by this address, never by import.
  { path: "games/:gameId", element: <GamePage /> },
  // FRONTEND-009's pages. Public: sports data is a read path. The tabs
  // (FRONTEND-019 added Records) are child routes, so the address alone decides which one shows;
  // `/stats` itself is the Seasons tab's.
  {
    path: "stats",
    element: <StatsPage />,
    children: [
      { index: true, element: <Navigate to="seasons" replace /> },
      { path: "seasons", element: <SeasonsTab /> },
      { path: "records", element: <RecordsTab /> },
      { path: "players", element: <PlayersTab /> },
    ],
  },
  { path: "players/:playerId", element: <PlayerPage /> },

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
];

const overlays: RouteObject[] = [
  {
    // FRONTEND-014: one dialog for every detail of a flow. Pathless, so it
    // stays mounted while the details below switch inside it.
    element: <DetailModal />,
    children: [
      // FRONTEND-010's thread modal. Public: a thread is a read path
      // ([[0x06-feed]]); replying inside it needs a session, and the modal
      // itself offers a signed-out reader the way to one. A direct load is
      // still the modal, over the feed: a thread has no page of its own.
      { path: "posts/:postId", element: <ThreadModal /> },
      // FRONTEND-014: a game and a player opened from a card or from inside
      // the modal. Only as a step of a flow: loaded by address, each is the
      // page of the same name above.
      flowOnly({ path: "games/:gameId", element: <GameDetail /> }),
      flowOnly({ path: "players/:playerId", element: <PlayerDetail /> }),
    ],
  },
  // FRONTEND-020: the composer, over the page it was opened from (or the
  // feed, for a direct load). Its own dialog, never inside the detail's: a
  // link to it from a detail carries the flow's background, so the detail
  // closes under it. Signed-in only, with RequireAuth inside ComposeModal.
  { path: "compose", element: <ComposeModal /> },
];

export const routes: RouteObject[] = [
  {
    // Pathless: a layout route with a path of its own would match `/` by
    // itself, outranking the splat under it, and render an empty `main`.
    element: <AppLayout />,
    children: [
      {
        path: "*",
        element: <BackgroundRoutes pages={pages} overlays={overlays} />,
      },
    ],
  },
];
