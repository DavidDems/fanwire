import { act } from "@testing-library/react";
import { onTestFinished } from "vitest";

/**
 * The browser behaviour a post card waits on before it is revealed
 * (`FRONTEND-015`), which jsdom does not have: image loading, `decode()` and
 * `IntersectionObserver`.
 *
 * jsdom never fetches an image, so an `<img>` or a `new Image()` neither loads
 * nor fails by itself, it has no `decode()` at all, and there is no
 * `IntersectionObserver` global. Each stub here puts that behaviour under the
 * test's control instead: a test decides, per image URL, whether it loads,
 * fails or never answers, and, per element, whether it is inside the
 * prepare window.
 *
 * Both are installed from inside a test body and restore themselves when that
 * test finishes (`onTestFinished`), so nothing leaks into the next test and no
 * `afterEach` has to be remembered. Neither is installed globally from
 * `setupTests.ts`: a test that never asks for them sees jsdom as it is.
 */

/** Where an image URL stands, as far as every element pointed at it can tell. */
type ImageState = "pending" | "loaded" | "failed" | "undecodable";

export interface ImageControl {
  /** Every URL an image element was pointed at, first request first. */
  readonly requested: string[];
  /** Has any image element (a `new Image()` or a rendered `<img>`) been pointed at `url`? */
  wasRequested(url: string): boolean;
  /** How many distinct image elements were pointed at `url`: a re-preload adds one. */
  requestCount(url: string): number;
  /** `url` loads: `load` fires on every element pointed at it and `decode()` resolves. */
  load(url: string): Promise<void>;
  /** `url` fails: `error` fires on every element pointed at it and `decode()` rejects. */
  fail(url: string): Promise<void>;
  /** `url` loads but cannot be decoded: `load` fires and `decode()` rejects. */
  loadUndecodable(url: string): Promise<void>;
}

export interface StubImagesOptions {
  /**
   * Load every URL as soon as an element is pointed at it, a tick later — for
   * a test that is about something else and only needs its cards revealed.
   * Without it every URL stalls until the test settles it.
   */
  autoLoad?: boolean;
}

/** Enough turns of the microtask queue for a `decode().then(…)` chain to land. */
async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

/** How many of this file's own `act` scopes are open right now. */
let actDepth = 0;

/**
 * Run `work` inside `act`, so the renders it causes have landed when the
 * promise resolves — unless it is already inside one of this file's `act`
 * scopes, or inside Testing Library's `waitFor` (which turns the act
 * environment off while it polls). An `act` opened inside another one leaves
 * React's act queue unflushed, and the *next* test then renders into a
 * container that stays empty.
 */
async function inAct(work: () => void): Promise<void> {
  const environment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  if (actDepth > 0 || environment === false) {
    work();
    await flushMicrotasks();
    return;
  }
  actDepth += 1;
  try {
    await act(async () => {
      work();
      await flushMicrotasks();
    });
  } finally {
    actDepth -= 1;
  }
}

/**
 * Stub image loading and `HTMLImageElement.prototype.decode`.
 *
 * Every image element is tracked by the `src` it is given, whether through the
 * `src` property (`new Image(); image.src = …`) or the attribute (React's
 * `<img src>`). A URL starts `pending`; the test settles it with `load`,
 * `fail` or `loadUndecodable`, and every element pointed at it hears about it
 * at once, including one pointed at it later (a browser answers that one from
 * its cache). `decode()` settles with the URL: resolved once it has loaded,
 * rejected once it has failed or cannot be decoded, and pending until then.
 * `complete` and `naturalWidth` follow the same state.
 */
export function stubImages(options: StubImagesOptions = {}): ImageControl {
  const proto = HTMLImageElement.prototype;
  const originalSrc = Object.getOwnPropertyDescriptor(proto, "src");
  const originalComplete = Object.getOwnPropertyDescriptor(proto, "complete");
  const originalNaturalWidth = Object.getOwnPropertyDescriptor(
    proto,
    "naturalWidth",
  );
  const ownSetAttribute = Object.getOwnPropertyDescriptor(
    proto,
    "setAttribute",
  );
  const originalDecode = Object.getOwnPropertyDescriptor(proto, "decode");
  if (originalSrc?.set === undefined) {
    throw new Error("jsdom's HTMLImageElement has no src setter to wrap");
  }

  const states = new Map<string, ImageState>();
  const elements = new Map<string, Set<HTMLImageElement>>();
  const decodeWaiters = new Map<
    string,
    { resolve: () => void; reject: (error: unknown) => void }[]
  >();
  const requested: string[] = [];

  function stateOf(url: string | null): ImageState {
    return url === null ? "pending" : (states.get(url) ?? "pending");
  }

  function settleDecodes(url: string): void {
    const state = stateOf(url);
    if (state === "pending") return;
    for (const waiter of decodeWaiters.get(url) ?? []) {
      if (state === "loaded") waiter.resolve();
      else waiter.reject(new DOMException("cannot decode", "EncodingError"));
    }
    decodeWaiters.delete(url);
  }

  function announce(element: HTMLImageElement, state: ImageState): void {
    if (state === "pending") return;
    element.dispatchEvent(new Event(state === "failed" ? "error" : "load"));
  }

  function settle(url: string, state: ImageState): Promise<void> {
    return inAct(() => {
      states.set(url, state);
      for (const element of elements.get(url) ?? []) announce(element, state);
      settleDecodes(url);
    });
  }

  function track(element: HTMLImageElement, url: string): void {
    if (!elements.has(url)) {
      elements.set(url, new Set());
      requested.push(url);
    }
    const tracked = elements.get(url) as Set<HTMLImageElement>;
    if (tracked.has(element)) return;
    tracked.add(element);

    if (options.autoLoad === true && stateOf(url) === "pending") {
      // A tick later, as a browser would: the code that set `src` attaches its
      // listeners after doing so as often as before.
      void Promise.resolve().then(() => settle(url, "loaded"));
      return;
    }
    const state = stateOf(url);
    if (state !== "pending") {
      void Promise.resolve().then(() => inAct(() => announce(element, state)));
    }
  }

  Object.defineProperty(proto, "src", {
    configurable: true,
    enumerable: originalSrc.enumerable,
    get: originalSrc.get,
    set(this: HTMLImageElement, value: string) {
      originalSrc.set?.call(this, value);
      track(this, String(value));
    },
  });
  Object.defineProperty(proto, "setAttribute", {
    configurable: true,
    writable: true,
    value(this: HTMLImageElement, name: string, value: string) {
      Element.prototype.setAttribute.call(this, name, value);
      if (name.toLowerCase() === "src") track(this, String(value));
    },
  });
  Object.defineProperty(proto, "decode", {
    configurable: true,
    writable: true,
    value(this: HTMLImageElement): Promise<void> {
      const url = this.getAttribute("src");
      if (url === null || url === "") {
        return Promise.reject(new DOMException("no src", "EncodingError"));
      }
      return new Promise<void>((resolve, reject) => {
        const waiters = decodeWaiters.get(url) ?? [];
        waiters.push({ resolve, reject });
        decodeWaiters.set(url, waiters);
        settleDecodes(url);
      });
    },
  });
  Object.defineProperty(proto, "complete", {
    configurable: true,
    get(this: HTMLImageElement) {
      return stateOf(this.getAttribute("src")) !== "pending";
    },
  });
  Object.defineProperty(proto, "naturalWidth", {
    configurable: true,
    get(this: HTMLImageElement) {
      return stateOf(this.getAttribute("src")) === "failed" ? 0 : 800;
    },
  });

  onTestFinished(() => {
    Object.defineProperty(proto, "src", originalSrc);
    for (const [name, descriptor] of [
      ["setAttribute", ownSetAttribute],
      ["decode", originalDecode],
      ["complete", originalComplete],
      ["naturalWidth", originalNaturalWidth],
    ] as const) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(proto, name);
      } else {
        Object.defineProperty(proto, name, descriptor);
      }
    }
  });

  return {
    requested,
    wasRequested: (url) => elements.has(url),
    requestCount: (url) => elements.get(url)?.size ?? 0,
    load: (url) => settle(url, "loaded"),
    fail: (url) => settle(url, "failed"),
    loadUndecodable: (url) => settle(url, "undecodable"),
  };
}

/** One `new IntersectionObserver(…)` the code under test made. */
export interface StubObserver {
  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit;
  /** What it observes right now. */
  readonly targets: Set<Element>;
  /** The observer itself, as the callback's second argument. */
  readonly observer: IntersectionObserver;
}

export interface IntersectionControl {
  /** Every observer constructed, in order. */
  readonly observers: StubObserver[];
  /** Every element observed right now by any observer, in document order. */
  observed(): Element[];
  /**
   * `element` enters the prepare window: every observer watching it, an
   * element inside it, or an element around it hears `isIntersecting: true`.
   * A test passes the list item it means (`li` of the feed's `ol`), and the
   * card inside it, whatever it observes, is the one told.
   */
  enter(element: Element): Promise<void>;
  /** `element` leaves the window again: `isIntersecting: false`. */
  leave(element: Element): Promise<void>;
}

export interface StubIntersectionObserverOptions {
  /**
   * Report every element as intersecting the moment it is observed — for a
   * test that is about something else. Without it nothing intersects until
   * the test says so.
   */
  intersectAll?: boolean;
}

function related(target: Element, element: Element): boolean {
  return (
    target === element || element.contains(target) || target.contains(element)
  );
}

function entryFor(
  target: Element,
  isIntersecting: boolean,
): IntersectionObserverEntry {
  const rect = target.getBoundingClientRect();
  return {
    target,
    isIntersecting,
    intersectionRatio: isIntersecting ? 1 : 0,
    boundingClientRect: rect,
    intersectionRect: rect,
    rootBounds: null,
    time: 0,
  };
}

/**
 * Install an `IntersectionObserver` global whose intersections the test
 * decides. The observer's options are recorded, so a test can read the
 * `rootMargin` the window was built with.
 */
export function stubIntersectionObserver(
  options: StubIntersectionObserverOptions = {},
): IntersectionControl {
  const observers: StubObserver[] = [];
  const hadOwn = Object.prototype.hasOwnProperty.call(
    window,
    "IntersectionObserver",
  );
  const previous = (window as { IntersectionObserver?: unknown })
    .IntersectionObserver;

  class FakeIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly thresholds: ReadonlyArray<number>;
    readonly scrollMargin = "0px";
    private readonly record: StubObserver;

    constructor(
      callback: IntersectionObserverCallback,
      init: IntersectionObserverInit = {},
    ) {
      this.root = init.root ?? null;
      this.rootMargin = init.rootMargin ?? "0px";
      const threshold = init.threshold ?? 0;
      this.thresholds = Array.isArray(threshold) ? threshold : [threshold];
      this.record = {
        callback,
        options: init,
        targets: new Set(),
        observer: this,
      };
      observers.push(this.record);
    }

    observe(target: Element): void {
      this.record.targets.add(target);
      if (options.intersectAll === true) {
        this.record.callback([entryFor(target, true)], this);
      }
    }

    unobserve(target: Element): void {
      this.record.targets.delete(target);
    }

    disconnect(): void {
      this.record.targets.clear();
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  Object.defineProperty(window, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: FakeIntersectionObserver,
  });

  onTestFinished(() => {
    if (hadOwn) {
      Object.defineProperty(window, "IntersectionObserver", {
        configurable: true,
        writable: true,
        value: previous,
      });
    } else {
      Reflect.deleteProperty(window, "IntersectionObserver");
    }
  });

  function tell(element: Element, isIntersecting: boolean): Promise<void> {
    return inAct(() => {
      for (const observer of observers) {
        const entries = [...observer.targets]
          .filter((target) => related(target, element))
          .map((target) => entryFor(target, isIntersecting));
        if (entries.length > 0) observer.callback(entries, observer.observer);
      }
    });
  }

  return {
    observers,
    observed() {
      const all = new Set<Element>();
      for (const observer of observers) {
        for (const target of observer.targets) all.add(target);
      }
      return [...all].sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
      );
    },
    enter: (element) => tell(element, true),
    leave: (element) => tell(element, false),
  };
}
