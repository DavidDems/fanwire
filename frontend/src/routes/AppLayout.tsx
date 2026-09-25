import { Link, Outlet } from "react-router-dom";

/**
 * The shell every route renders inside: primary navigation, and the one `main`
 * landmark the route's view is rendered into.
 *
 * Deliberately unstyled and minimal — this is the frame the next six units fill
 * in, not a design.
 */
export function AppLayout() {
  return (
    <>
      <header>
        <nav aria-label="Primary">
          <ul>
            <li>
              <Link to="/">Feed</Link>
            </li>
            <li>
              <Link to="/compose">Compose</Link>
            </li>
            <li>
              <Link to="/notifications">Notifications</Link>
            </li>
            <li>
              <Link to="/search">Search</Link>
            </li>
          </ul>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
