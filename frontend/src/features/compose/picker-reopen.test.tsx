import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithAuth } from "../../test/auth";
import { ComposePage } from "./ComposePage";
vi.mock("./StatsPicker", () => {
  throw new Error("offline picker chunk");
});

it("closing and reopening a failed picker retries the import with the draft intact", async () => {
  const user = userEvent.setup();
  renderWithAuth(<ComposePage />);
  await user.type(
    screen.getByRole("textbox", { name: /post/i }),
    "Keep this draft",
  );
  await user.click(screen.getByRole("button", { name: "Attach stats" }));
  const dialog = await screen.findByRole("dialog", { name: "Attach stats" });
  expect(
    await within(dialog).findByText(
      "We could not open this just now. Please try again.",
    ),
  ).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  vi.doMock("./StatsPicker", () => ({
    StatsPicker: () => <p>Recovered picker</p>,
  }));
  await user.click(screen.getByRole("button", { name: "Attach stats" }));
  expect(await screen.findByText("Recovered picker")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /post/i })).toHaveValue(
    "Keep this draft",
  );
});
