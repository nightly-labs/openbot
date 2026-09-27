import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageError } from "../src/components/landing/PageError";

afterEach(cleanup);

describe("public page errors", () => {
  it("offers a retry and a way home when a page fails", async () => {
    const retry = vi.fn();
    render(() => <PageError onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Check your connection and reload the page.");
    await fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
  });
});
