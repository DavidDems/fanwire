import { useLayoutEffect, useState } from "react";

/**
 * Whether the media query `query` matches now, kept current as it changes
 * (`FRONTEND-036`): the one place a viewport width reaches JavaScript. The
 * home page mounts its right rail from `(min-width: 72em)` through it, so a
 * narrow screen never mounts the rail or makes its requests.
 *
 * It listens for `change` on the query's list, so a resize across the
 * breakpoint re-renders with no reload, and stops on unmount. Where there is
 * no `matchMedia` it answers `false`, the narrow layout. The first answer is
 * read in a layout effect, before the browser paints, so a wide screen never
 * shows the narrow layout first.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useLayoutEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
