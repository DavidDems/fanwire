import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { buttonClass } from "./Button";
import styles from "./Menu.module.css";

export interface MenuItem {
  /** The item's text, which is also its accessible name. */
  label: string;
  /** What choosing it does. The menu has closed, and focus is on its button. */
  onSelect: () => void;
  /** Announced as disabled and does nothing ("Reported"); still reachable by the arrows. */
  disabled?: boolean;
}

export interface MenuProps {
  /** The button's accessible name, and the menu's ("More options"). */
  label: string;
  items: MenuItem[];
  /** Shown in the button in place of the label, which stays its name. */
  icon?: ReactNode;
}

/** Space between the button and the menu, and between the menu and the viewport's edge. */
const OFFSET_PX = 4;
const EDGE_PX = 8;

/**
 * A button and the list of actions it opens (`FRONTEND-012`; `components.md`
 * §2: the Popover API before any dependency). The post card's "More options"
 * is the first one.
 *
 * **A `popover="manual"` list, shown with `showPopover()`**, so it sits in the
 * top layer over everything, a modal `<dialog>` included, and is never clipped
 * by a card. Manual rather than `auto`: the browser's own light dismiss closes
 * it on the button's press too, which the click then reopens, so closing is
 * this component's: Escape, Tab, a choice, the button again, or focus leaving
 * the menu (a press anywhere else). It is placed under the button's end edge
 * (above it, near the bottom of the viewport) and follows it while open.
 * Where the API is missing (jsdom), the list still renders in place.
 *
 * **Rendered only while open**, in the button's own DOM (no portal), so a card
 * holds its own menu and a closed one adds no text to the card.
 *
 * **The keyboard of a menu** (APG "Menu Button"): Enter, Space or a click
 * opens it with focus on the first item; ArrowDown and ArrowUp move (and wrap),
 * Home and End jump; one item is in the tab order at a time. **Escape closes
 * it, and only it**: focus goes back to the button, and the key is stopped and
 * default-prevented here, because its default is what closes a `<dialog>`
 * around the menu (the thread modal) and a parent's own key handler must not
 * see it either. **Tab leaves**: focus moves on as usual, and the menu closes
 * behind it.
 */
export function Menu({ label, items, icon }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const button = buttonRef.current;
    if (!open || list === null || button === null) return;

    // Set here rather than as a prop: React 18's types predate the attribute.
    // Before the first paint, so the list is never seen outside the top layer.
    list.setAttribute("popover", "manual");
    let place = (): void => {};
    if (typeof list.showPopover === "function") {
      list.showPopover();
      place = () => {
        const anchor = button.getBoundingClientRect();
        const below = anchor.bottom + OFFSET_PX;
        const fitsBelow = below + list.offsetHeight <= window.innerHeight;
        const top = fitsBelow
          ? below
          : Math.max(EDGE_PX, anchor.top - OFFSET_PX - list.offsetHeight);
        // End-aligned with the button, kept inside the viewport's edges.
        const left = Math.max(
          EDGE_PX,
          Math.min(
            anchor.right - list.offsetWidth,
            window.innerWidth - EDGE_PX - list.offsetWidth,
          ),
        );
        list.style.top = `${top}px`;
        list.style.left = `${left}px`;
      };
      place();
      window.addEventListener("resize", place);
      // Captured, so a scroll inside the thread modal moves it too.
      document.addEventListener("scroll", place, true);
    }
    itemRefs.current[0]?.focus();

    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      if (
        typeof list.hidePopover === "function" &&
        list.matches(":popover-open")
      ) {
        list.hidePopover();
      }
    };
  }, [open]);

  function show(): void {
    setActive(0);
    setOpen(true);
  }

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function choose(item: MenuItem): void {
    if (item.disabled === true) return;
    close(true);
    item.onSelect();
  }

  function moveTo(index: number): void {
    const count = items.length;
    if (count === 0) return;
    const next = (index + count) % count;
    setActive(next);
    itemRefs.current[next]?.focus();
  }

  function handleButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (
      !open &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();
      show();
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    switch (event.key) {
      case "Escape":
        // The menu's own: neither a dialog around it nor a parent hears it.
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      case "ArrowDown":
        event.preventDefault();
        moveTo(active + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveTo(active - 1);
        return;
      case "Home":
        event.preventDefault();
        moveTo(0);
        return;
      case "End":
        event.preventDefault();
        moveTo(items.length - 1);
        return;
      default:
        // Tab is left alone: focus moves on, and the blur below closes it.
        return;
    }
  }

  function handleMenuBlur(event: FocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    // Back on the button: its own click decides (a second click closes).
    if (next !== null && next === buttonRef.current) return;
    close(false);
  }

  return (
    <div className={styles.menuButton}>
      <button
        ref={buttonRef}
        type="button"
        className={`${buttonClass("ghost", "sm")} ${styles.button}`}
        aria-label={icon === undefined ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) close(true);
          else show();
        }}
        onKeyDown={handleButtonKeyDown}
      >
        {icon ?? label}
      </button>
      {open ? (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={styles.menu}
          onKeyDown={handleMenuKeyDown}
          onBlur={handleMenuBlur}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              className={styles.item}
              tabIndex={index === active ? 0 : -1}
              aria-disabled={item.disabled === true ? true : undefined}
              onFocus={() => {
                setActive(index);
              }}
              onClick={() => {
                choose(item);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
