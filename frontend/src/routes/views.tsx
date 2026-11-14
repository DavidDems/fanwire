import type { ReactNode } from "react";

/**
 * The shell's own views — now only the not-found page.
 *
 * This file began as one placeholder per route, so that every route existed
 * from day one and each unit could land independently. Each unit then pointed
 * the route table at its own page and its placeholder went away with it;
 * `FRONTEND-007`'s `SearchView` was the last. What is left belongs to no
 * feature, and talks to no API.
 */

function Page({
  heading,
  children,
}: {
  heading: string;
  children?: ReactNode;
}) {
  return (
    <section>
      <h1>{heading}</h1>
      {children}
    </section>
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
