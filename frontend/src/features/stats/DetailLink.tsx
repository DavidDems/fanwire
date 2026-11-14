import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useDetailLinkState } from "../../routes/modal-flow";

/**
 * A link to a game or a player from the Stats page (FRONTEND-041): the same
 * router `<Link>` to the same address, carrying the modal flow's link state
 * as Recent Games does, so it opens as the detail modal over the Stats page
 * and closing it returns to the page as it was. A direct load or a new tab
 * of the address is still the full page.
 */
export function DetailLink({
  to,
  children,
}: {
  to: string;
  children?: ReactNode;
}) {
  const state = useDetailLinkState();
  return (
    <Link to={to} state={state}>
      {children}
    </Link>
  );
}
