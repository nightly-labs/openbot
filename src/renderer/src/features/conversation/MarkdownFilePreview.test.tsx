import { render, screen } from "@solidjs/testing-library";
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
      renderedClass="message-markdown"
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
});
