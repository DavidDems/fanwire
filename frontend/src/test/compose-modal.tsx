import { posix } from "node:path";

import { HttpResponse, http, type RequestHandler } from "msw";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { components } from "../api/schema";
import type { IconProps } from "../components/ui/icons";
import { TEST_UPLOAD_URL, processedMedia, testMedia } from "./compose";
import {
  isAtRule,
  parseCss,
  readSrcFile,
  rootCustomProperties,
  selectors,
} from "./css";
import { declared, lastCompoundClasses } from "./module-css";

/**
 * The compose modal's kit (`FRONTEND-020`): the image check's words and
 * network doubles, the attach row's icons, and a reader for the size a CSS
 * module gives a control.
 *
 * The image check is driven by time, so the doubles here answer by the clock
 * rather than by call number: a poll answered `processed` only from a given
 * moment on is what tells "a final poll at the 30 s bound" from "the 31st
 * poll", whatever second the first poll falls on.
 */

type MediaOut = components["schemas"]["MediaOut"];
type MediaStatus = components["schemas"]["MediaStatus"];

/** The one refusal line, for every way an image can be refused. */
export const IMAGE_REFUSED =
  "The image you attached is too large or cannot be accepted";

/** The tile's status line while the image is uploaded and checked. */
export const IMAGE_CHECKING = "Checking the image…";

/** A failure to reach the API or the bucket: today's line, kept. */
export const IMAGE_UPLOAD_FAILED =
  "We could not upload that image. Please try again.";

/** The bound on the check, from the end of the bucket upload. */
export const CHECK_BOUND_MS = 30_000;

/**
 * The composer's one file input. It is visually hidden and opened by the
 * paperclip, so it is found by its type: it has no label of its own (the
 * paperclip's "Attach an image" is the one control named for an image).
 */
export function imageFileInput(root: ParentNode = document): HTMLInputElement {
  const inputs = root.querySelectorAll<HTMLInputElement>('input[type="file"]');
  if (inputs.length !== 1) {
    throw new Error(`expected one file input, found ${inputs.length}`);
  }
  return inputs[0];
}

/** An icon's drawing: its shape elements and their attributes, size and class aside. */
export function iconShapes(svg: Element): string[] {
  return [...svg.children].map((shape) => {
    const attributes = [...shape.attributes]
      .map((attribute) => `${attribute.name}=${attribute.value}`)
      .sort();
    return `${shape.localName}[${attributes.join(" ")}]`;
  });
}

/** What `Icon` draws, to compare a rendered `<svg>` against. */
export function referenceIconShapes(Icon: ComponentType<IconProps>): string[] {
  const template = document.createElement("template");
  template.innerHTML = renderToStaticMarkup(<Icon />);
  const svg = template.content.querySelector("svg");
  if (svg === null) throw new Error("the reference icon rendered no <svg>");
  return iconShapes(svg);
}

/** Whether `element` holds exactly one `<svg>`, aria-hidden, drawn as `Icon`. */
export function drawsIcon(
  element: Element,
  Icon: ComponentType<IconProps>,
): boolean {
  const svgs = [...element.querySelectorAll("svg")];
  return (
    svgs.length === 1 &&
    svgs[0].getAttribute("aria-hidden") === "true" &&
    JSON.stringify(iconShapes(svgs[0])) ===
      JSON.stringify(referenceIconShapes(Icon))
  );
}

/** The text a reader gets from `element`, whitespace collapsed. */
export function textOf(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

export interface HeldBucket {
  handler: RequestHandler;
  /** How many uploads reached the bucket. */
  readonly calls: number;
  /** `Date.now()` when the last upload was answered, or `null`. */
  readonly endedAt: number | null;
  /** Hold every upload open until `release()`. */
  hold(): void;
  /** Answer the held upload (204), and every later one at once. */
  release(): void;
  /** Answer every upload with this status from now on. */
  answerWith(status: number): void;
}

/** The bucket, as `./compose`'s `s3Upload`, but holdable and timed. */
export function heldBucket(): HeldBucket {
  let calls = 0;
  let endedAt: number | null = null;
  let status = 204;
  let gate: Promise<void> | null = null;
  let open = (): void => {};

  return {
    handler: http.post(TEST_UPLOAD_URL, async () => {
      calls += 1;
      if (gate !== null) await gate;
      endedAt = Date.now();
      return new HttpResponse(null, { status });
    }),
    get calls() {
      return calls;
    },
    get endedAt() {
      return endedAt;
    },
    hold(): void {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release(): void {
      gate = null;
      open();
    },
    answerWith(next: number): void {
      status = next;
    },
  };
}

export interface MediaPoll {
  handler: RequestHandler;
  /** `Date.now()` at each `GET /media/{id}`, in order. */
  readonly times: number[];
}

/**
 * `GET /media/{media_id}`, answering `status(now)` for the fake clock's `now`:
 * a pipeline that finishes at a moment, not on a call number.
 */
export function mediaPoll(status: (now: number) => MediaStatus): MediaPoll {
  const times: number[] = [];
  return {
    handler: http.get<{ media_id: string }>(
      "*/media/:media_id",
      ({ params }) => {
        const now = Date.now();
        times.push(now);
        const id = Number(params.media_id);
        const answer = status(now);
        const body =
          answer === "processed"
            ? processedMedia({ id })
            : testMedia({ id, status: answer });
        return HttpResponse.json<MediaOut>(body);
      },
    ),
    times,
  };
}

// ---------------------------------------------------- sizes from CSS modules

const ROOT_FONT_PX = 16;

/** The `:root` tokens, read once. */
let tokens: Map<string, string> | null = null;

function tokenMap(): Map<string, string> {
  tokens ??= rootCustomProperties(parseCss(readSrcFile("styles/tokens.css")));
  return tokens;
}

/**
 * A length in rem, with `var(--token)` resolved from `tokens.css`,
 * `env(…)` taken as 0 (the smallest a device gives) and `calc()` worked out.
 * `null` for anything it cannot read (a percentage, `auto`, a keyword).
 */
export function lengthInRem(value: string): number | null {
  let text = value.trim().toLowerCase();
  for (let depth = 0; depth < 10 && /var\(/.test(text); depth += 1) {
    text = text.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g,
      (_all, name: string, fallback: string | undefined) =>
        tokenMap().get(name) ?? fallback ?? "NaN",
    );
  }
  text = text
    .replace(/env\([^()]*\)/g, "0rem")
    .replace(/\bcalc\(/g, "(")
    .replace(/(-?\d*\.?\d+)rem\b/g, "($1)")
    .replace(/(-?\d*\.?\d+)px\b/g, `($1/${ROOT_FONT_PX})`);
  if (!/^[\d.+\-*/()\s]+$/.test(text)) return null;
  try {
    const result = Function(`"use strict"; return (${text});`)() as unknown;
    return typeof result === "number" && Number.isFinite(result)
      ? result
      : null;
  } catch {
    return null;
  }
}

/** The values of `padding`'s shorthand, split at the top level only. */
export function shorthandParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value.trim()) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (current !== "") parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current !== "") parts.push(current);
  return parts;
}

/**
 * CSS modules as `import.meta.glob(…, { eager: true })` hands them, keyed by
 * their path under `src/` (see `cssModulesFrom`).
 */
export type CssModules = Record<string, Record<string, string>>;

/**
 * A glob result re-keyed by path under `src/`: `base` is the globbing file's
 * own directory under `src/` (`"features/compose"`).
 */
export function cssModulesFrom(
  glob: Record<string, unknown>,
  base: string,
): CssModules {
  const modules: CssModules = {};
  for (const [key, value] of Object.entries(glob)) {
    const classes = (value as { default?: Record<string, string> }).default;
    if (classes === undefined) continue;
    modules[posix.normalize(posix.join(base, key))] = classes;
  }
  return modules;
}

/**
 * The smallest width and height the top-level rules of `modules` give
 * `element` through the classes it carries, in rem (`min-*`, or a fixed
 * `width`/`height`/`inline-size`/`block-size`, whichever is larger). A class
 * is matched by what the module's own import maps it to, so this reads the
 * rules the rendered control really carries.
 */
export function minimumBoxInRem(
  element: Element,
  modules: CssModules,
): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (const [path, classes] of Object.entries(modules)) {
    for (const block of parseCss(readSrcFile(path))) {
      if (isAtRule(block)) continue;
      const carried = selectors(block).some((selector) =>
        lastCompoundClasses(selector).some((name) => {
          const mapped = classes[name];
          return (
            typeof mapped === "string" &&
            mapped
              .split(/\s+/)
              .some((cls) => cls !== "" && element.classList.contains(cls))
          );
        }),
      );
      if (!carried) continue;
      for (const property of [
        "min-width",
        "width",
        "inline-size",
        "min-inline-size",
      ]) {
        const value = declared(block, property);
        const rem = value === undefined ? null : lengthInRem(value);
        if (rem !== null) width = Math.max(width, rem);
      }
      for (const property of [
        "min-height",
        "height",
        "block-size",
        "min-block-size",
      ]) {
        const value = declared(block, property);
        const rem = value === undefined ? null : lengthInRem(value);
        if (rem !== null) height = Math.max(height, rem);
      }
    }
  }
  return { width, height };
}
