/**
 * FRONTEND-014 criteria 1 to 4: a post card renders its `data_link_preview`
 * as one of three components (a game result, a player's game line, a player's
 * career), and each preview's one link to its detail is its own element,
 * separate from the card's thread navigation.
 *
 * Rendered through `PostNode`, which is what the feed, search and the thread
 * modal all use. What each preview shows is pinned by its content, not its
 * markup: both teams and the final score, the player and his line, the scope
 * and the averages. A figure the source does not have is never invented: a
 * DNP shows its reason instead of figures, a null average is an em dash, and a
 * link whose target has no preview is "Stats unavailable".
 *
 * A figure is found with digit boundaries rather than word ones, because
 * adjacent cells' text runs together in `textContent` ("PTS31").
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { renderWithAuth } from "../../test/auth";
import {
  testAuthor,
  testPlainRepost,
  testPostView,
  testQuoteRepost,
  type PostView,
} from "../../test/feed";
import {
  BARNES_ID,
  BARNES_LINE_ID,
  LEBRON_ID,
  PREVIEW_GAME_ID,
  dnpPlayerGamePreview,
  gameFinalPreview,
  playerCareerPreview,
  playerGamePreview,
  postWithPreview,
  postWithUnavailableLink,
} from "../../test/previews";
import { PostNode } from "./PostNode";

const EM_DASH = "—";

const GAME_HREF = `/games/${PREVIEW_GAME_ID}`;
const LINE_HREF = `/games/${PREVIEW_GAME_ID}?line=${BARNES_LINE_ID}`;
const CAREER_HREF = `/players/${LEBRON_ID}`;

function renderCard(post: PostView) {
  return renderWithAuth(<PostNode post={post} />);
}

/** The outermost card. */
function card(): HTMLElement {
  const article = document.querySelector<HTMLElement>("article");
  if (article === null) throw new Error("no card rendered");
  return article;
}

function text(element: HTMLElement): string {
  return element.textContent ?? "";
}

/** `value` as a figure of its own: not part of a longer number. */
function figure(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d.])${escaped}(?![\\d])`);
}

/** The card's links into a game or player detail. */
function detailLinks(root: HTMLElement): HTMLAnchorElement[] {
  return [...root.querySelectorAll<HTMLAnchorElement>("a[href]")].filter(
    (link) => /^\/(games|players)\//.test(link.getAttribute("href") ?? ""),
  );
}

function onlyDetailLink(root: HTMLElement): HTMLAnchorElement {
  const links = detailLinks(root);
  expect(
    links.map((link) => link.getAttribute("href")),
    "one link to the preview's detail",
  ).toHaveLength(1);
  return links[0];
}

/** The smallest ancestor of `element` whose text includes `needle`. */
function nearestHolding(element: Element, needle: string): Element | null {
  let node: Element | null = element;
  while (node !== null && !(node.textContent ?? "").includes(needle)) {
    node = node.parentElement;
  }
  return node;
}

describe("a game_final preview", () => {
  it("shows both teams, the final score and the date", () => {
    renderCard(postWithPreview(gameFinalPreview()));
    const body = text(card());

    expect(body).toMatch(/Toronto Raptors|\bTOR\b/);
    expect(body).toMatch(/Phoenix Suns|\bPHX\b/);
    expect(body).toMatch(figure("117"));
    expect(body).toMatch(figure("109"));
    expect(body).toMatch(/15 Jan(uary)? 2024/);
  });

  it("shows a playoff game's label", () => {
    renderCard(
      postWithPreview(
        gameFinalPreview({
          game_type: "playoffs",
          label: "East Conference Finals",
          sub_label: "Game 4",
          series_game_number: 4,
        }),
      ),
    );

    expect(text(card())).toContain("East Conference Finals");
  });

  it("has one link, to /games/<game_id>", () => {
    renderCard(postWithPreview(gameFinalPreview()));

    expect(onlyDetailLink(card())).toHaveAttribute("href", GAME_HREF);
  });

  it("shows period values in a semantic table and names both teams and score in its link", () => {
    const preview = {
      ...gameFinalPreview(),
      home_line_score: [25, 30, 30, 32],
      away_line_score: [20, 25, 32, 32],
    };
    renderCard(postWithPreview(preview));

    expect(onlyDetailLink(card())).toHaveAccessibleName(
      /Phoenix Suns.*109.*Toronto Raptors.*117/,
    );
    const table = screen.getByRole("table", { name: /period score/i });
    expect(table).toHaveTextContent(/Q1.*20.*25/);
    expect(table).toHaveTextContent(/Q4.*32.*32/);
  });

  it("omits only the period breakdown when line scores are unavailable", () => {
    const preview = {
      ...gameFinalPreview(),
      home_line_score: null,
      away_line_score: null,
    };
    renderCard(postWithPreview(preview));

    expect(onlyDetailLink(card())).toHaveAttribute("href", GAME_HREF);
    expect(screen.queryByRole("table", { name: /period score/i })).toBeNull();
  });
});

describe("a player_game preview", () => {
  it("shows the player, his team, the opponent, the result and the date", () => {
    renderCard(postWithPreview(playerGamePreview()));
    const body = text(card());

    expect(body).toContain("Scottie Barnes");
    expect(body).toMatch(/Toronto Raptors|\bTOR\b/);
    expect(body).toMatch(/Phoenix Suns|\bPHX\b/);
    // The result: a win, with its score.
    expect(body).toMatch(/\bW\b|\bWon\b|\bWin\b/);
    expect(body).toMatch(figure("117"));
    expect(body).toMatch(figure("109"));
    expect(body).toMatch(/15 Jan(uary)? 2024/);
  });

  it("shows the line: minutes, points, rebounds, assists and shooting", () => {
    renderCard(postWithPreview(playerGamePreview()));
    const body = text(card());

    // 2175 seconds: 36:15.
    expect(body).toMatch(/(?<!\d)36(:15)?(?!\d)/);
    expect(body).toMatch(figure("31"));
    expect(body).toMatch(figure("13"));
    expect(body).toMatch(figure("9"));
    expect(body).toMatch(/(?<!\d)11[-–/]19(?!\d)/);
  });

  it("shows a DNP line's reason instead of figures", () => {
    renderCard(postWithPreview(dnpPlayerGamePreview("Rest")));
    const body = text(card());

    expect(body).toContain("Scottie Barnes");
    expect(body).toContain("Rest");
    expect(body).not.toMatch(/(?<!\d)0:00(?!\d)/);
    expect(body).not.toMatch(/(?<!\d)0[-–/]0(?!\d)/);
  });

  it("says the player did not play when the DNP has no reason", () => {
    renderCard(postWithPreview(dnpPlayerGamePreview(null)));

    expect(text(card())).toMatch(/did not play|\bDNP\b/i);
  });

  it("has one link, to /games/<game_id>?line=<line_id>", () => {
    renderCard(postWithPreview(playerGamePreview()));

    expect(onlyDetailLink(card())).toHaveAttribute("href", LINE_HREF);
  });

  it("does not link the player separately", () => {
    renderCard(postWithPreview(playerGamePreview()));

    expect(
      detailLinks(card()).filter(
        (link) => link.getAttribute("href") === `/players/${BARNES_ID}`,
      ),
    ).toEqual([]);
  });
});

describe("a player_career preview", () => {
  it("shows the player, the regular season's label, games played and the averages", () => {
    renderCard(postWithPreview(playerCareerPreview()));
    const body = text(card());

    expect(body).toContain("LeBron James");
    expect(body).toContain("Regular season");
    expect(body).toMatch(figure("1492"));
    expect(body).toMatch(figure("27.1"));
    expect(body).toMatch(figure("7.5"));
    expect(body).toMatch(figure("7.4"));
  });

  it("labels the playoffs scope Playoffs", () => {
    renderCard(
      postWithPreview(
        playerCareerPreview({
          scope: "playoffs",
          games_played: 287,
          points_per_game: 28.4,
        }),
      ),
    );
    const body = text(card());

    expect(body).toContain("Playoffs");
    expect(body).not.toContain("Regular season");
    expect(body).toMatch(figure("287"));
    expect(body).toMatch(figure("28.4"));
  });

  it("shows a null average as an em dash", () => {
    renderCard(
      postWithPreview(playerCareerPreview({ assists_per_game: null })),
    );

    expect(text(card())).toContain(EM_DASH);
  });

  it("shows every average as an em dash for a scope with no games", () => {
    renderCard(
      postWithPreview(
        playerCareerPreview({
          scope: "playoffs",
          games_played: 0,
          minutes_per_game: null,
          points_per_game: null,
          rebounds_per_game: null,
          assists_per_game: null,
          field_goal_pct: null,
          three_point_pct: null,
          free_throw_pct: null,
        }),
      ),
    );
    const body = text(card());

    expect(body).toContain(EM_DASH);
    expect(body).not.toMatch(/(?<!\d)0\.0(?!\d)/);
  });

  it("has one link, to /players/<player_id>", () => {
    renderCard(postWithPreview(playerCareerPreview()));

    expect(onlyDetailLink(card())).toHaveAttribute("href", CAREER_HREF);
  });
});

describe("a link with no preview, and no link at all", () => {
  it("shows 'Stats unavailable' when data_link is set and data_link_preview is null", () => {
    renderCard(postWithUnavailableLink({ text: "Look at this game" }));

    expect(screen.getByText(/stats unavailable/i)).toBeInTheDocument();
    expect(screen.getByText("Look at this game")).toBeInTheDocument();
  });

  it("shows nothing new for a post with neither", () => {
    renderCard(testPostView({ text: "Just words" }));

    expect(screen.queryByText(/stats unavailable/i)).toBeNull();
    expect(detailLinks(card())).toEqual([]);
  });
});

describe("previews on reposts", () => {
  const ORIGINAL_TEXT = "The original take";
  const QUOTE_TEXT = "Quoting it with a game";

  it("a plain repost shows the original's preview inside the reposted card", () => {
    const original = postWithPreview(playerCareerPreview(), {
      id: 401,
      text: ORIGINAL_TEXT,
      author: testAuthor({ id: 21, username: "original21" }),
    });
    renderCard(testPlainRepost(original));

    expect(text(card())).toContain("LeBron James");
    expect(onlyDetailLink(card())).toHaveAttribute("href", CAREER_HREF);
  });

  it("a quote repost shows its own preview, and its reposted card the original's", () => {
    const original = postWithPreview(playerCareerPreview(), {
      id: 401,
      text: ORIGINAL_TEXT,
      author: testAuthor({ id: 21, username: "original21" }),
    });
    renderCard(
      testQuoteRepost(original, QUOTE_TEXT, {
        data_link: { type: "game_final", ref_id: PREVIEW_GAME_ID, scope: null },
        data_link_preview: gameFinalPreview(),
      }),
    );
    const links = detailLinks(card());
    const game = links.filter(
      (link) => link.getAttribute("href") === GAME_HREF,
    );
    const career = links.filter(
      (link) => link.getAttribute("href") === CAREER_HREF,
    );

    expect(game).toHaveLength(1);
    expect(career).toHaveLength(1);
    // The career preview sits in the original's box: the smallest container
    // around it that holds the original's text does not hold the quote's.
    const box = nearestHolding(career[0], ORIGINAL_TEXT);
    expect(box).not.toBeNull();
    expect(box?.textContent ?? "").not.toContain(QUOTE_TEXT);
    // The game preview is the quote's own: not inside the original's box.
    expect(box?.contains(game[0])).toBe(false);
  });
});

describe("the preview link is separate from the card's thread navigation", () => {
  const POST_ID = 101;

  function previews(): Array<[string, PostView, string]> {
    return [
      ["game_final", postWithPreview(gameFinalPreview()), GAME_HREF],
      ["player_game", postWithPreview(playerGamePreview()), LINE_HREF],
      ["player_career", postWithPreview(playerCareerPreview()), CAREER_HREF],
    ];
  }

  it.each(previews())(
    "%s: the timestamp and Reply still lead to the thread, and neither holds the preview link",
    (_type, post, href) => {
      renderCard(post);
      const preview = onlyDetailLink(card());
      const time = card().querySelector("time");
      const timestamp = time?.closest("a") ?? null;
      const reply = screen.getByRole("link", { name: "Reply" });

      expect(preview).toHaveAttribute("href", href);
      expect(timestamp).toHaveAttribute("href", `/posts/${POST_ID}`);
      expect(reply).toHaveAttribute("href", `/posts/${POST_ID}?reply=1`);
      expect(timestamp?.contains(preview)).toBe(false);
      expect(preview.contains(timestamp)).toBe(false);
      expect(preview.contains(reply)).toBe(false);
      // No link inside another: each is its own tab stop.
      expect(preview.querySelector("a")).toBeNull();
      expect(preview.parentElement?.closest("a")).toBeNull();
    },
  );

  /** Every pathname the router visits, in order. */
  function Visited({ into }: { into: string[] }) {
    const location = useLocation();
    useEffect(() => {
      into.push(`${location.pathname}${location.search}`);
    }, [location, into]);
    return null;
  }

  it.each(previews())(
    "%s: activating the preview goes to the detail and never opens the thread",
    async (_type, post, href) => {
      const user = userEvent.setup();
      const visited: string[] = [];
      renderWithAuth(
        <>
          <Visited into={visited} />
          <Routes>
            <Route path="/" element={<PostNode post={post} />} />
            <Route path="/games/:gameId" element={<p>Game detail</p>} />
            <Route path="/players/:playerId" element={<p>Player detail</p>} />
            <Route path="/posts/:postId" element={<p>Thread detail</p>} />
          </Routes>
        </>,
      );

      await user.click(onlyDetailLink(card()));

      await waitFor(() => expect(visited.at(-1)).toBe(href));
      expect(screen.queryByText("Thread detail")).toBeNull();
      expect(visited.some((entry) => entry.startsWith("/posts/"))).toBe(false);
    },
  );
});
