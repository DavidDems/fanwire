#!/usr/bin/env node
/*
 * axe-check.cjs: runs axe-core against the local dev app, signed in with the
 * dev test account (ADR 0045; wiki/CodeContext/FrontendUI/verification-browser.md
 * §3a "axe").
 *
 *   node scripts/axe-check.cjs [base-url]      (from frontend/)
 *
 * - Localhost only: any base URL whose host is not localhost or 127.0.0.1 is
 *   refused, so it can never run against the live site.
 * - axe comes from node_modules (axe-core), never a CDN.
 * - The browser is the installed Chrome (playwright-core, channel "chrome"),
 *   headless, in a fresh non-persistent context: nothing it signs into
 *   survives the run.
 * - The account is FANWIRE_TEST_1_* in the untracked
 *   frontend/.env.test-accounts.local. Its email and password are never
 *   printed or written anywhere.
 *
 * Prints one line per surface, scheme and width (counts by impact, then the
 * rule ids and targets of serious and critical violations) and writes the full
 * axe results to .playwright-mcp/ at the repo root (gitignored). Exits 1 when
 * any serious or critical violation is found.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const BASE = new URL(process.argv[2] || "http://localhost:5173");
if (!["localhost", "127.0.0.1"].includes(BASE.hostname)) {
  console.error(`Refused: ${BASE.origin} is not localhost.`);
  process.exit(2);
}
const AXE = require.resolve("axe-core/axe.min.js");
const OUT_DIR = path.resolve(__dirname, "../../.playwright-mcp");
const ACCOUNT_FILE = path.resolve(__dirname, "../.env.test-accounts.local");
const SCHEMES = ["light", "dark"];
const WIDTHS = [1280, 360];
const IMPACTS = ["critical", "serious", "moderate", "minor"];
const RUN_OPTIONS = {
  runOnly: {
    type: "tag",
    values: [
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa",
      "best-practice",
    ],
  },
};

/** KEY=value lines; the values stay in memory only. */
function readAccount() {
  if (!fs.existsSync(ACCOUNT_FILE)) return null;
  const env = {};
  for (const line of fs.readFileSync(ACCOUNT_FILE, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  const { FANWIRE_TEST_1_EMAIL: email, FANWIRE_TEST_1_PASSWORD: password } =
    env;
  const username = env.FANWIRE_TEST_1_USERNAME;
  return email && password && username ? { email, password, username } : null;
}

/** Signs in through the app's own page; creates the profile on a fresh stack. */
async function signIn(page, account) {
  await page.goto(new URL("/sign-in", BASE).href);
  await page.fill("#sign-in-email", account.email);
  await page.fill("#sign-in-password", account.password);
  await page.click('form button[type="submit"]');
  try {
    await page.waitForURL((url) => url.pathname !== "/sign-in", {
      timeout: 15000,
    });
  } catch {
    return "sign-in did not leave /sign-in (wrong pool, or the account is gone)";
  }
  // The guard sends a visitor who already has a profile back to the feed.
  await page.goto(new URL("/create-profile", BASE).href);
  await page.waitForLoadState("networkidle");
  if (await page.locator("#profile-username").count()) {
    await page.fill("#profile-username", account.username);
    await page.fill("#profile-date-of-birth", "1990-01-01");
    await page.click('form button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
  }
  return null;
}

/** Puts data-axe="<name>" on an element found in the page, for an include. */
async function tag(page, name, finder) {
  const handle = await page.evaluateHandle(finder);
  return handle.evaluate((element, name) => {
    if (element instanceof Element) element.setAttribute("data-axe", name);
    return element instanceof Element;
  }, name);
}

async function runAxe(page, include) {
  await page.addScriptTag({ path: AXE }).catch(() => undefined);
  return page.evaluate(
    ([include, options]) =>
      window.axe.run(include ? { include } : document, options),
    [include, RUN_OPTIONS],
  );
}

/** Each page, what to wait for, and the scoped surfaces tagged on it. */
function pages(links) {
  return [
    {
      name: "home",
      path: "/",
      ready: "main",
      surfaces: [
        { name: "shell (whole page /)" },
        {
          name: "rail",
          wide: true,
          find: () => document.querySelector("main aside"),
        },
        {
          name: "recent games",
          wide: true,
          find: () =>
            document.querySelector(
              'section[aria-labelledby="recent-games-heading"]',
            ),
        },
      ],
    },
    links.game && {
      name: "game",
      path: links.game,
      ready: '[role="tablist"]',
      surfaces: [
        { name: "game page (whole)" },
        {
          name: "team tabs",
          find: () => document.querySelector('[role="tablist"]').parentElement,
        },
      ],
    },
    links.team && {
      name: "team season",
      path: links.team,
      ready: 'svg[role="img"][aria-label^="Wins and losses"]',
      surfaces: [
        { name: "team season (whole)" },
        {
          name: "chart",
          find: () =>
            document.querySelector(
              'svg[role="img"][aria-label^="Wins and losses"]',
            ).parentElement,
        },
        {
          name: "result cards",
          find: () =>
            document.querySelector(
              'svg[role="img"][aria-label^="Wins and losses"]',
            ).parentElement.nextElementSibling,
        },
      ],
    },
  ].filter(Boolean);
}

/** The first Recent Games card, then its away team's Stats > Seasons link. */
async function findLinks(page) {
  const links = {};
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE.href);
  const card = page.locator(
    'section[aria-labelledby="recent-games-heading"] a[href*="/games/"]',
  );
  try {
    await card.first().waitFor({ timeout: 15000 });
  } catch {
    return links;
  }
  links.game = await card.first().getAttribute("href");
  await page.goto(new URL(links.game, BASE).href);
  const team = page.locator(
    'h1 a[href*="/stats/seasons"], main a[href*="/stats/seasons?"]',
  );
  await team
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => undefined);
  if (await team.count()) links.team = await team.first().getAttribute("href");
  return links;
}

function summarise(results) {
  const counts = Object.fromEntries(IMPACTS.map((impact) => [impact, 0]));
  const severe = [];
  for (const violation of results.violations) {
    counts[violation.impact] =
      (counts[violation.impact] || 0) + violation.nodes.length;
    if (violation.impact === "serious" || violation.impact === "critical") {
      for (const node of violation.nodes) {
        severe.push(
          `${violation.impact} ${violation.id} ${node.target.join(" ")}`,
        );
      }
    }
  }
  return {
    counts,
    severe,
    minor: results.violations.map((v) => `${v.impact}:${v.id}`),
  };
}

async function main() {
  const account = readAccount();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const report = {
    base: BASE.origin,
    browser: browser.version(),
    date: new Date().toISOString(),
  };

  report.signIn = account ? await signIn(page, account) : "no account file";
  console.log(
    `${report.browser}, ${BASE.origin}, signed in: ${report.signIn ?? "yes"}`,
  );

  report.links = await findLinks(page);
  report.runs = [];
  let severeTotal = 0;
  for (const target of pages(report.links)) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const scheme of SCHEMES) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(new URL(target.path, BASE).href);
        await page
          .waitForSelector(target.ready, { timeout: 15000 })
          .catch(() => undefined);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500); // let colour transitions finish
        for (const surface of target.surfaces) {
          if (surface.wide && width < 1280) continue;
          let include = null;
          if (surface.find) {
            const found = await tag(page, surface.name, surface.find).catch(
              () => false,
            );
            if (!found) {
              console.log(
                `${surface.name} | ${scheme} | ${width}: not on the page`,
              );
              continue;
            }
            include = [[`[data-axe="${surface.name}"]`]];
          }
          const results = await runAxe(page, include);
          const { counts, severe, minor } = summarise(results);
          severeTotal += severe.length;
          report.runs.push({
            surface: surface.name,
            path: target.path,
            scheme,
            width,
            counts,
            results,
          });
          const line = IMPACTS.map(
            (impact) => `${impact} ${counts[impact]}`,
          ).join(", ");
          console.log(
            `${surface.name} | ${scheme} | ${width}: ${line} [${minor.join(" ")}]`,
          );
          for (const item of severe) console.log(`    ${item}`);
        }
      }
    }
  }

  await browser.close();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(
    OUT_DIR,
    `axe-${report.date.replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`Full results: ${path.relative(process.cwd(), file)}`);
  process.exitCode = severeTotal > 0 ? 1 : 0;
}

main().catch((error) => {
  // Playwright errors can quote a filled value; print the message's first line only.
  console.error(String(error && error.message).split("\n")[0]);
  process.exit(2);
});
