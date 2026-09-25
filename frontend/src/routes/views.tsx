import type { ReactNode } from "react";
import { useParams } from "react-router-dom";

/**
 * Placeholder views — one per route in the shell that no unit has filled in yet.
 *
 * Every route exists from day one so the remaining units can land independently:
 * each one replaces the body of its own view without touching the route table,
 * the navigation, or anybody else's page. A placeholder still has to be the
 * *right* placeholder — the heading is the view's identity, in tests and to a
 * screen reader.
 *
 * `FRONTEND-002` lifted the four auth views out of here into real pages under
 * `src/auth/`, which is the shape every later unit follows: the route table
 * points at the unit's own page and the placeholder goes away with it.
 *
 * Nothing here talks to the API. The unit that owns each page brings its own
 * queries with it.
 */

function Page({ heading, children }: { heading: string; children?: ReactNode }) {
  return (
    <section>
      <h1>{heading}</h1>
      {children}
    </section>
  );
}

export function FeedView() {
  return (
    <Page heading="Feed">
      <p>Posts land here.</p>
    </Page>
  );
}

export function ComposeView() {
  return (
    <Page heading="Compose">
      <p>Writing a post lands here.</p>
    </Page>
  );
}

export function NotificationsView() {
  return (
    <Page heading="Notifications">
      <p>What happened while you were away lands here.</p>
    </Page>
  );
}

export function SearchView() {
  return (
    <Page heading="Search">
      <p>Finding people, posts and games lands here.</p>
    </Page>
  );
}

export function ProfileView() {
  const { userId } = useParams<{ userId: string }>();

  return (
    <Page heading="Profile">
      <p>User {userId}</p>
    </Page>
  );
}

/**
 * The application's own catch-all. Without it react-router renders its built-in
 * error element, whose "404 Not Found" heading reads green to a test while the
 * app has no not-found page at all.
 */
export function NotFoundView() {
  return (
    <Page heading="Not found">
      <p>There is no page at this address.</p>
    </Page>
  );
}
