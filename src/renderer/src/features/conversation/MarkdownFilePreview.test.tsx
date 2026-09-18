import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { MarkdownFilePreview } from "./MarkdownFilePreview";

const callbacks = {
  onSelectAgent: vi.fn(),
  onOpenLink: vi.fn(),
  onOpenSharedFile: vi.fn(),
  onOpenWorkspaceFile: vi.fn(),
};

function renderPreview(body: string) {
  return render(() => (
    <MarkdownFilePreview
      body={body}
      agents={[]}
      resetKey="preview.md"
      renderedClass="message-markdown"
      sourceClass="markdown-source"
      statusClass="markdown-status"
      truncatedClass="markdown-truncated"
      {...callbacks}
    />
  ));
}

describe("MarkdownFilePreview", () => {
  it("renders common Markdown elements and safe links", async () => {
    renderPreview(
      [
        "# Release notes",
        "",
        "Use **bold** and *emphasis*.",
        "",
        "| Name | Status |",
        "| --- | --- |",
        "| Preview | Ready |",
        "",
        "[OpenBot](https://openbot.run)",
      ].join("\n"),
    );

    expect(screen.getByRole("heading", { level: 1, name: "Release notes" })).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("emphasis").tagName).toBe("EM");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OpenBot" })).toBeInTheDocument();
  });

  it("escapes raw HTML and drops unsafe links", () => {
    renderPreview("<script>alert('xss')</script>\n\n[unsafe](javascript:alert('xss'))");

    expect(screen.queryByRole("script")).not.toBeInTheDocument();
    expect(screen.getByText("<script>alert('xss')</script>")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "unsafe" })).not.toBeInTheDocument();
    expect(screen.getByText("unsafe")).toBeInTheDocument();
  });

  it("switches to the original source and back to rendered Markdown", async () => {
    const body = "# Source check\n\n**Keep this syntax.**";
    renderPreview(body);

    await fireEvent.click(screen.getByRole("button", { name: "View source" }));
    expect(screen.getByRole("button", { name: "View rendered Markdown" })).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === body)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Source check" })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "View rendered Markdown" }));
    expect(screen.getByRole("heading", { level: 1, name: "Source check" })).toBeInTheDocument();
  });
});
