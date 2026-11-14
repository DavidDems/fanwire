/** R23: an import failure stays in the dialog and a new import can recover. */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("./AppLayout", async () => ({
  ShellAccountStatus: (await import("react")).createContext("active"),
}));
vi.mock("./guards", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./modal-flow", () => ({ useComposeClose: () => () => {} }));
vi.mock("../features/compose/ComposePage", () => {
  throw new Error("offline composer chunk");
});
import { ComposeModal } from "./ComposeModal";

const FAILURE = "We could not open this just now. Please try again.";

describe("failed composer chunk", () => {
  it("keeps the app mounted, offers retry, reimports and refetches failed same-origin CSS before recovering", async () => {
    const user = userEvent.setup();
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/assets/ComposePage-offline.css";
    Object.defineProperty(stylesheet, "sheet", {
      configurable: true,
      value: {
        get cssRules() {
          throw new DOMException("unavailable", "SecurityError");
        },
      },
    });
    document.head.append(stylesheet);
    const missing = document.createElement("link");
    missing.rel = "stylesheet";
    missing.href = "/assets/ComposePage-missing.css";
    Object.defineProperty(missing, "sheet", {
      configurable: true,
      value: null,
    });
    document.head.append(missing);
    const external = document.createElement("link");
    external.rel = "stylesheet";
    external.href = "https://example.com/external.css";
    document.head.append(external);
    render(
      <>
        <p>Page underneath</p>
        <ComposeModal />
      </>,
    );
    try {
      expect(await screen.findByText(FAILURE)).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Compose" })).toHaveAttribute(
        "open",
      );
      expect(screen.getByText("Page underneath")).toBeInTheDocument();
      vi.doMock("../features/compose/ComposePage", () => ({
        ComposePage: () => <textarea aria-label="Recovered composer" />,
      }));
      await user.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(stylesheet.isConnected).toBe(false));
      const replacement = [
        ...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
      ].find((link) => link.href.endsWith("/assets/ComposePage-offline.css"));
      expect(replacement).toBeDefined();
      expect(missing.isConnected).toBe(false);
      const missingReplacement = [
        ...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
      ].find((link) => link.href.endsWith("/assets/ComposePage-missing.css"));
      expect(missingReplacement).toBeDefined();
      missingReplacement?.dispatchEvent(new Event("load"));
      expect(external.isConnected).toBe(true);
      replacement?.dispatchEvent(new Event("load"));
      expect(
        await screen.findByRole("textbox", { name: "Recovered composer" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(FAILURE)).toBeNull();
    } finally {
      document
        .querySelector('link[href="/assets/ComposePage-offline.css"]')
        ?.remove();
      [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
        .filter((link) => link.href.endsWith("/assets/ComposePage-missing.css"))
        .forEach((link) => link.remove());
      external.remove();
    }
  });
});
