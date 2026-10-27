/** R23: the picker imports only after the chart press and failed imports retry. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithAuth } from "../../test/auth";
import { ComposePage } from "./ComposePage";

vi.mock("./StatsPicker", () => {
  throw new Error("offline picker chunk");
});
const FAILURE = "We could not open this just now. Please try again.";

it("a failed picker stays inside its dialog and Try again imports it afresh without losing the draft", async () => {
  const user = userEvent.setup();
  renderWithAuth(<ComposePage />);
  await user.type(
    screen.getByRole("textbox", { name: /post/i }),
    "Keep this draft",
  );
  expect(screen.queryByText(FAILURE)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Attach stats" }));
  const dialog = await screen.findByRole("dialog", { name: "Attach stats" });
  expect(await within(dialog).findByText(FAILURE)).toBeInTheDocument();
  vi.doMock("./StatsPicker", () => ({
    StatsPicker: () => <p>Recovered picker</p>,
  }));
  await user.click(within(dialog).getByRole("button", { name: "Try again" }));
  expect(
    await within(dialog).findByText("Recovered picker"),
  ).toBeInTheDocument();
  await waitFor(() => expect(within(dialog).queryByText(FAILURE)).toBeNull());
  expect(screen.getByRole("textbox", { name: /post/i })).toHaveValue(
    "Keep this draft",
  );
});
