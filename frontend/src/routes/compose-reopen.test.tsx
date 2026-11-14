import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("./AppLayout", async () => ({
  ShellAccountStatus: (await import("react")).createContext("active"),
}));
vi.mock("./guards", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./modal-flow", () => ({ useComposeClose: () => () => {} }));
vi.mock("../features/compose/ComposePage", () => {
  throw new Error("offline chunk");
});
import { ComposeModal } from "./ComposeModal";

it("closing and reopening after an import rejection imports the composer afresh", async () => {
  const view = render(<ComposeModal />);
  expect(
    await screen.findByText(
      "We could not open this just now. Please try again.",
    ),
  ).toBeInTheDocument();
  view.unmount();
  vi.doMock("../features/compose/ComposePage", () => ({
    ComposePage: () => <textarea aria-label="Recovered composer" />,
  }));
  render(<ComposeModal />);
  expect(
    await screen.findByRole("textbox", { name: "Recovered composer" }),
  ).toBeInTheDocument();
});
