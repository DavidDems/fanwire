import { useRef, type ComponentType } from "react";
import { Link, NavLink, Outlet, useMatch } from "react-router-dom";

import symbol from "../assets/brand/symbol.svg";
import wordmarkDark from "../assets/brand/wordmark-dark.svg";
import wordmarkLight from "../assets/brand/wordmark-light.svg";
import { useAuth } from "../auth/AuthContext";
import { useProfile } from "../auth/profile";
import { buttonClass } from "../components/ui/Button";
import {
  BellIcon,
  HouseIcon,
  SearchIcon,
  SquarePenIcon,
  UserIcon,
  type IconProps,
} from "../components/ui/icons";
import styles from "./AppLayout.module.css";

interface NavItemProps {
  to: string;
  label: string;
  Icon: ComponentType<IconProps>;
  end?: boolean;
}

/**
 * One primary-nav item: an `aria-hidden` icon above (phones) or hidden beside
 * (from 40em) its unchanged text label, which is the link's accessible name.
 * `NavLink` sets `aria-current="page"`, which is what the CSS keys the
 * current-item bar and weight on.
 */
function NavItem({ to, label, Icon, end }: NavItemProps) {
  return (
    <li>
      <NavLink to={to} end={end} className={styles.link}>
        <Icon className={styles.icon} />
        {label}
      </NavLink>
    </li>
  );
}

/**
 * The shell every route renders inside (`wiki/CodeContext/FrontendUI/layout.md`
 * §2): a skip link, the sticky header with the brand, the one primary nav, and
 * the one `main` landmark the route's view is rendered into.
 *
 * **One nav, moved by CSS.** On phones `AppLayout.module.css` fixes the nav to
 * the bottom of the viewport; from 40em it sits inline in the header. The DOM
 * never changes shape between breakpoints, because jsdom applies no media
 * queries and a second nav would double every nav link the tests look for.
 *
 * "Your profile" is built from the signed-in user's id, because `/profile/:userId`
 * has no fixed address for "me" and without this link there is no way to reach
 * the own-profile variant from inside the app. It is rendered only for a visitor
 * who has a profile: an anonymous one has no id to link to, and a signed-in one
 * whose `GET /users/me` is a 404 has no profile row yet — the state
 * `RequireNewProfile` exists for, and `/profile/undefined` is the bug it
 * prevents. The profile is read through the one shared query, gated on the
 * session exactly as the guards gate it, so the shell asks the API nothing until
 * somebody signs in.
 *
 * "Sign in" is offered to an anonymous visitor only, and not on `/sign-in`
 * itself, where it would be a link to the page already open.
 */
export function AppLayout() {
  const { status } = useAuth();
  const profile = useProfile(status === "authenticated");
  const ownUserId =
    status === "authenticated" ? (profile.data?.id ?? null) : null;
  const onSignInPage = useMatch("/sign-in") !== null;
  const mainRef = useRef<HTMLElement>(null);

  return (
    <>
      <a
        href="#main"
        className={styles.skipLink}
        // A hash link does not move focus everywhere (nor in jsdom), so move it.
        onClick={() => mainRef.current?.focus()}
      >
        Skip to content
      </a>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <img src={symbol} alt="" width={28} height={28} />
          <picture className={styles.wordmark}>
            <source
              srcSet={wordmarkDark}
              media="(prefers-color-scheme: dark)"
            />
            <img src={wordmarkLight} alt="fanwire" width={93} height={20} />
          </picture>
        </Link>
        <nav aria-label="Primary" className={styles.nav}>
          <ul className={styles.list}>
            <NavItem to="/" label="Feed" Icon={HouseIcon} end />
            <NavItem to="/compose" label="Compose" Icon={SquarePenIcon} />
            <NavItem
              to="/notifications"
              label="Notifications"
              Icon={BellIcon}
            />
            <NavItem to="/search" label="Search" Icon={SearchIcon} />
            {ownUserId === null ? null : (
              <NavItem
                to={`/profile/${ownUserId}`}
                label="Your profile"
                Icon={UserIcon}
              />
            )}
          </ul>
        </nav>
        {status === "anonymous" && !onSignInPage ? (
          <Link
            to="/sign-in"
            className={`${buttonClass("secondary", "md")} ${styles.signIn}`}
          >
            Sign in
          </Link>
        ) : null}
      </header>
      <main id="main" tabIndex={-1} ref={mainRef} className={styles.main}>
        <Outlet />
      </main>
    </>
  );
}
