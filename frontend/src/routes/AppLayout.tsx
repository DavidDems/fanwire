import { createContext, useRef, type ComponentType } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  matchPath,
  useLocation,
  useMatch,
  useNavigate,
} from "react-router-dom";

import wordmarkDark from "../assets/brand/wordmark-dark.png";
import wordmarkLight from "../assets/brand/wordmark-light.png";
import {
  useAccount,
  useAccountDeletionNotice,
  useSignOut,
  type AccountStatus,
} from "../auth/account";
import { useAuth } from "../auth/AuthContext";
import { buttonClass } from "../components/ui/Button";
import { FloatingButton } from "../components/ui/FloatingButton";
import { Avatar } from "../components/ui/Avatar";
import { Menu } from "../components/ui/Menu";
import { StatusLine } from "../components/ui/StatusLine";
import {
  BellIcon,
  ChartColumnIcon,
  CirclePlusIcon,
  HouseIcon,
  LogOutIcon,
  SearchIcon,
  type IconProps,
} from "../components/ui/icons";
import styles from "./AppLayout.module.css";
import { DeactivatedBanner } from "./Deactivated";
import { useComposeLinkState } from "./modal-flow";

/**
 * The account state the shell has already read, for what renders inside it
 * (`ComposeModal`): one more `useAccount()` would be one more observer of the
 * profile query, and a stale query is read again when an observer mounts, so
 * opening compose would cost a `GET /users/me`.
 */
export const ShellAccountStatus = createContext<AccountStatus>("loading");

interface NavItemProps {
  to: string;
  label: string;
  Icon: ComponentType<IconProps>;
  end?: boolean;
  /**
   * Further route patterns this item is current on, beyond its own address:
   * Stats is current on `/players/:playerId` too, because a player page is
   * reached from the Stats page's Players tab and belongs to that section.
   */
  alsoCurrentOn?: string[];
  /** A class for the item's `<li>`: the nav's Search is hidden on phones. */
  itemClassName?: string;
}

/** Icons in the nav and the header's Search: Lucide's own 24 px grid. */
const NAV_ICON_SIZE = 24;

/**
 * An item's content: its `aria-hidden` icon, then its label in the shared
 * `.visually-hidden` class (icons only in the bar and the compact sidebar),
 * which `styles.label` shows again in the labelled sidebar from 78em. The label
 * is the control's accessible name at every width.
 */
function ItemContent({
  label,
  Icon,
}: {
  label: string;
  Icon: ComponentType<IconProps>;
}) {
  return (
    <>
      <Icon className={styles.icon} size={NAV_ICON_SIZE} />
      <span className={`visually-hidden ${styles.label}`}>{label}</span>
    </>
  );
}

/**
 * One primary-nav item. `NavLink` sets `aria-current="page"`, which is what the
 * CSS keys the current-item bar and weight on.
 */
function NavItem({
  to,
  label,
  Icon,
  end,
  alsoCurrentOn = [],
  itemClassName,
}: NavItemProps) {
  const { pathname } = useLocation();
  const elsewhere = alsoCurrentOn.some(
    (pattern) => matchPath(pattern, pathname) !== null,
  );
  const content = <ItemContent label={label} Icon={Icon} />;
  return (
    <li className={itemClassName}>
      {elsewhere ? (
        // NavLink sets aria-current only on its own address, so a page of the
        // same section outside it says so itself.
        <Link to={to} className={styles.link} aria-current="page">
          {content}
        </Link>
      ) : (
        <NavLink to={to} end={end} className={styles.link}>
          {content}
        </NavLink>
      )}
    </li>
  );
}

/**
 * The shell every route renders inside (`wiki/CodeContext/FrontendUI/layout.md`
 * §2): a skip link, the sticky header with the brand, the one primary nav, and
 * the one `main` landmark the route's view is rendered into.
 *
 * **One nav, moved by CSS** (`FRONTEND-035`). It follows the header and shares
 * a parent with `main`. On phones `AppLayout.module.css` fixes it to the bottom
 * of the viewport as an icon bar; from 40em the parent lays it and `main` out
 * as one centred group, the nav a sticky left sidebar, icon only until 78em and
 * labelled from there. The DOM never changes shape between breakpoints,
 * because jsdom applies no media queries and a second nav would double every
 * nav link the tests look for.
 *
 * **Two Search links, one shown** (the exception to `layout.md` §1,
 * `decisions.md` 2026-11-05): the bar has no room for Search, so on phones it
 * is an icon link in the header, left of the Account menu or Sign in, and the
 * nav's own Search is `display: none`; from 40em the reverse. A hidden link
 * leaves the accessibility tree, so a reader meets one.
 *
 * The account menu is rendered only for an active profile. Its own-profile
 * destination uses the id from the one shared account query; anonymous,
 * profile-less and deactivated visitors have no menu or undefined profile URL.
 *
 * **The column** is `--content-max` wide on every route but `/stats/records`,
 * where it is `--content-max-wide` (`FRONTEND-030`), chosen here from the
 * route, so the records home's cards fit three to a row.
 *
 * **A deactivated account** (`FRONTEND-012`) gets `DeactivatedBanner` on every
 * page, between the header and `main`: a named region, so the header stays the
 * page's one banner landmark.
 *
 * **The floating +** (`FRONTEND-020`) opens compose over the page the reader is
 * on, for a signed-in active account only, on every page; it replaced the
 * Compose nav item. A button (FloatingButton's `onClick` form), because its
 * link form carries no history state. It sits outside `main`, so the compose
 * dialog, shown modally, takes it out of the tab order while it is open.
 *
 * "Sign in" is offered to an anonymous visitor only, and not on `/sign-in`
 * itself, where it would be a link to the page already open.
 *
 * "Sign out" (`FRONTEND-027`) is offered for any restored session, profile or
 * not, because a visitor with no profile yet has no other way out. Not to a
 * deactivated account: its banner and recovery screen already offer it. It is
 * the nav list's last item (`FRONTEND-035`), a button styled like the links and
 * never current. Guards handle a signed-in-only route, and a public page stays
 * where it is, read again as a guest (`useSignOut`).
 */
export function AppLayout() {
  const { status } = useAuth();
  const account = useAccount();
  const showAccountDeletionNotice = useAccountDeletionNotice();
  const location = useLocation();
  const signOut = useSignOut();
  const accountIsActive = account.status === "active";
  const ownUserId = accountIsActive ? account.profile.id : null;
  const onSignInPage = useMatch("/sign-in") !== null;
  // The records home's cards sit three to a row in a wider column (FRONTEND-030).
  const wide = useMatch("/stats/records") !== null;
  const mainRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const composeState = useComposeLinkState();

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
          <picture className={styles.wordmark}>
            <source
              srcSet={wordmarkDark}
              media="(prefers-color-scheme: dark)"
            />
            <img src={wordmarkLight} alt="fanwire" width={105} height={28} />
          </picture>
        </Link>
        <div className={styles.headerEnd}>
          <NavLink to="/search" className={styles.headerSearch}>
            <ItemContent label="Search" Icon={SearchIcon} />
          </NavLink>
          {!accountIsActive ? null : (
            <Menu
              label="Account menu"
              buttonClassName={styles.accountMenuButton}
              icon={
                <Avatar
                  username={account.profile.username}
                  size="sm"
                  avatarKey={account.profile.profile_avatar_key}
                  pictureKey={account.profile.profile_picture_key}
                />
              }
              items={(
                [
                  ["Profile", `/profile/${account.profile.id}`],
                  ["History", "/history"],
                  ["Account settings", "/settings"],
                ] as const
              ).map(([label, to]) => ({ label, onSelect: () => navigate(to) }))}
            />
          )}
          {status === "anonymous" && !onSignInPage ? (
            <Link to="/sign-in" className={buttonClass("secondary", "md")}>
              Sign in
            </Link>
          ) : null}
        </div>
      </header>
      {account.status === "deactivated" ? <DeactivatedBanner /> : null}
      <div className={styles.body}>
        <nav aria-label="Primary" className={styles.nav}>
          <ul className={styles.list}>
            <NavItem to="/" label="Home" Icon={HouseIcon} end />
            <NavItem
              to="/stats"
              label="Stats"
              Icon={ChartColumnIcon}
              alsoCurrentOn={["/players/*"]}
            />
            <NavItem
              to="/search"
              label="Search"
              Icon={SearchIcon}
              itemClassName={styles.sidebarOnly}
            />
            <NavItem
              to="/notifications"
              label="Notifications"
              Icon={BellIcon}
            />
            {status === "authenticated" && account.status !== "deactivated" ? (
              <li>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    signOut();
                    // This button has just gone: without this, focus falls to the body.
                    mainRef.current?.focus();
                  }}
                >
                  <ItemContent label="Sign out" Icon={LogOutIcon} />
                </button>
              </li>
            ) : null}
          </ul>
        </nav>
        <main
          id="main"
          tabIndex={-1}
          ref={mainRef}
          className={wide ? `${styles.main} ${styles.wide}` : styles.main}
        >
          {showAccountDeletionNotice ? (
            <StatusLine>Your account and data have been deleted.</StatusLine>
          ) : null}
          <ShellAccountStatus.Provider value={account.status}>
            {location.pathname === "/" && account.status === "no-profile" ? (
              <Navigate to="/create-profile" replace />
            ) : (
              <Outlet />
            )}
          </ShellAccountStatus.Provider>
        </main>
      </div>
      {ownUserId === null ? null : (
        <FloatingButton
          aria-label="Compose a post"
          onClick={() => {
            void navigate("/compose", { state: composeState });
          }}
        >
          <CirclePlusIcon />
        </FloatingButton>
      )}
    </>
  );
}
