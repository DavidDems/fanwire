/**
 * FRONTEND-007 — the free-text bar itself (criterion 8's control).
 *
 * The bar is one component used in two places, the home page and `/search`,
 * and both reach the same results view by *address*: submitting goes to
 * `/search?q=<text>`, and `SearchPage` reads `q` from there. That makes the
 * URL the seam, so what is pinned here is where a submit navigates to, and
 * that the box shows the `q` it was opened with.
 *
 * The backend validates `q` as 1–100 characters, stripped ([[0x07-search]]
 * Routes), so the box caps at 100, the submit trims, and an empty or
 * whitespace-only submit goes nowhere — a request the API would answer 422
 * is not one to send.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { SearchBar } from "./SearchBar";

const BOX_NAME = "Search accounts and posts";

/** Where the router is, as one text node. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <p>{`at ${pathname}${search}`}</p>;
}

function renderBar(route = "/") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/" element={<SearchBar />} />
        <Route path="/search" element={<SearchBar />} />
      </Routes>
      <LocationProbe />
    </>,
    { route },
  );
}

function currentQuery(): URLSearchParams {
  const text = screen.getByText(/^at /).textContent ?? "";
  return new URLSearchParams(text.replace(/^at [^?]*/, ""));
}

function currentPath(): string {
  const text = screen.getByText(/^at /).textContent ?? "";
  return text.replace(/^at /, "").replace(/\?.*$/, "");
}

describe("the search bar", () => {
  it("is a search landmark holding a labelled search box and a Search button", () => {
    renderBar();

    const form = screen.getByRole("search");
    expect(form.tagName).toBe("FORM");
    const box = within(form).getByRole("searchbox", { name: BOX_NAME });
    expect(box).toHaveAttribute("type", "search");
    expect(box).toHaveAttribute("maxLength", "100");
    const button = within(form).getByRole("button", { name: "Search" });
    expect(button).toHaveAttribute("type", "submit");
  });

  it("goes to /search?q= with the trimmed text on submit", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.type(
      screen.getByRole("searchbox", { name: BOX_NAME }),
      "  raptors in six  ",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(currentPath()).toBe("/search");
    expect(currentQuery().get("q")).toBe("raptors in six");
  });

  it("submits from the keyboard too", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.type(
      screen.getByRole("searchbox", { name: BOX_NAME }),
      "suns{Enter}",
    );

    expect(currentPath()).toBe("/search");
    expect(currentQuery().get("q")).toBe("suns");
  });

  it("goes nowhere on an empty submit", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(currentPath()).toBe("/");
  });

  it("goes nowhere on a whitespace-only submit", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.type(screen.getByRole("searchbox", { name: BOX_NAME }), "    ");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(currentPath()).toBe("/");
    expect(currentQuery().has("q")).toBe(false);
  });

  it("shows the q it was opened with on /search", () => {
    renderBar("/search?q=raptors");

    expect(screen.getByRole("searchbox", { name: BOX_NAME })).toHaveValue(
      "raptors",
    );
  });

  it("replaces the query on a second search from /search", async () => {
    const user = userEvent.setup();
    renderBar("/search?q=raptors");
    const box = screen.getByRole("searchbox", { name: BOX_NAME });

    await user.clear(box);
    await user.type(box, "suns{Enter}");

    expect(currentPath()).toBe("/search");
    expect(currentQuery().get("q")).toBe("suns");
  });
});
