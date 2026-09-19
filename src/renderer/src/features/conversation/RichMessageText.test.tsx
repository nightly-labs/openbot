import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "./DataTable";
import { MarkdownFilePreview } from "./MarkdownFilePreview";
import { RichMessageText } from "./RichMessageText";

const previewCallbacks = {
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
      {...previewCallbacks}
    />
  ));
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("RichMessageText tooltips", () => {
  it("resolves semantic skill tags by id and marks missing tags unavailable", () => {
    render(() => (
      <RichMessageText
        body="Use @[Old name](skill:skill-1) and ask @[Former](agent:agent-removed)."
        agents={[]}
        skills={[
          {
            skillId: "skill-1",
            slug: "release-notes",
            name: "Release Notes",
            installedVersion: 1,
            availableVersion: 1,
            state: "installed",
            description: "Turns merged work into clear release notes.",
          },
        ]}
        onSelectAgent={vi.fn()}
        onOpenLink={vi.fn()}
      />
    ));

    expect(screen.getByText("Skill")).toBeInTheDocument();
    expect(screen.getByText("Release Notes")).toBeInTheDocument();
    expect(screen.queryByText("Turns merged work into clear release notes.")).not.toBeInTheDocument();
    expect(screen.getByText("Unavailable agent")).toBeInTheDocument();
    expect(screen.getByText("Former")).toBeInTheDocument();
  });

  it("renders a plain attached file name as a styled reference", async () => {
    const attachment = {
      id: "report",
      name: "raport.csv",
      size: 1_024,
      kind: "file" as const,
      mimeType: "text/csv",
      previewKind: "text" as const,
      previewUrl: null,
    };
    const onOpenAttachment = vi.fn();
    render(() => (
      <RichMessageText
        body="Here is raport.csv."
        agents={[]}
        attachments={[attachment]}
        onSelectAgent={vi.fn()}
        onOpenLink={vi.fn()}
        onOpenAttachment={onOpenAttachment}
      />
    ));

    const reference = screen.getByRole("button", { name: "Open attached file raport.csv" });
    expect(reference).toHaveTextContent("CSV");
    expect(reference).not.toHaveTextContent("/OpenBot/");
    await fireEvent.click(reference);
    expect(onOpenAttachment).toHaveBeenCalledWith(attachment);
  });

  it("renders a shared path as a styled system-open reference", async () => {
    const onOpenSharedFile = vi.fn();
    render(() => (
      <RichMessageText
        body="Open ~/OpenBot/Shared/raport.csv."
        agents={[]}
        onSelectAgent={vi.fn()}
        onOpenLink={vi.fn()}
        onOpenSharedFile={onOpenSharedFile}
      />
    ));

    const reference = screen.getByRole("button", { name: "Open shared file raport.csv" });
    expect(reference).toHaveTextContent("CSV");
    expect(reference).not.toHaveTextContent("~/OpenBot/Shared");
    await fireEvent.click(reference);
    expect(onOpenSharedFile).toHaveBeenCalledWith("~/OpenBot/Shared/raport.csv");
  });

  it("associates a citation tooltip with its trigger and closes it with Escape", async () => {
    const onOpenLink = vi.fn();
    render(() => (
      <RichMessageText
        body="Read the source [1]."
        agents={[]}
        citations={[
          {
            number: 1,
            label: "Attention Is All You Need",
            url: "https://arxiv.org/abs/1706.03762",
            host: "arxiv.org",
          },
        ]}
        onSelectAgent={vi.fn()}
        onOpenLink={onOpenLink}
      />
    ));

    const citation = screen.getByRole("link", {
      name: "Open citation 1: Attention Is All You Need",
    });
    await fireEvent.focus(citation);
    const tooltip = await screen.findByRole("tooltip");
    expect(citation).toHaveAttribute("aria-describedby", tooltip.id);
    expect(tooltip).toHaveTextContent("Attention Is All You Need");

    await fireEvent.keyDown(citation, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    await fireEvent.click(citation);
    expect(onOpenLink).toHaveBeenLastCalledWith("https://arxiv.org/abs/1706.03762");

    await fireEvent.click(screen.getByRole("link", { name: "Open source 1: Attention Is All You Need" }));
    expect(onOpenLink).toHaveBeenCalledTimes(2);
    expect(onOpenLink).toHaveBeenLastCalledWith("https://arxiv.org/abs/1706.03762");
  });

  it("keeps a truncated file name visible after a touch tap while opening the file", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    const attachment = {
      id: "touch-file",
      name: "a-very-long-touch-friendly-file-name.pdf",
      size: 1_024,
      kind: "file" as const,
      mimeType: "application/pdf",
      previewKind: "pdf" as const,
      previewUrl: null,
    };
    const onOpenAttachment = vi.fn();
    render(() => (
      <RichMessageText
        body={`Review ${serializeAttachmentReference(attachment.name, attachment.id)}`}
        agents={[]}
        attachments={[attachment]}
        onSelectAgent={vi.fn()}
        onOpenLink={vi.fn()}
        onOpenAttachment={onOpenAttachment}
      />
    ));

    const reference = screen.getByRole("button", { name: `Open attached file ${attachment.name}` });
    const label = reference.querySelector<HTMLElement>(".inline-file-reference-name");
    if (!label) throw new Error("The touch file label is missing");
    Object.defineProperties(label, {
      clientWidth: { configurable: true, value: 120 },
      scrollWidth: { configurable: true, value: 320 },
    });

    await fireEvent.click(reference);
    expect(onOpenAttachment).toHaveBeenCalledWith(attachment);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(attachment.name);
  });
});

describe("DataTable", () => {
  it("renders an accessible semantic table and treats cell markup as text", () => {
    render(() => (
      <DataTable
        table={{
          type: "table",
          headers: ["Model", "Context"],
          alignments: ["left", "right"],
          rows: [["<strong>gpt-4o</strong>", "128k"]],
        }}
      />
    ));

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(within(table).getAllByRole("cell")).toHaveLength(2);
    expect(within(table).getByText("<strong>gpt-4o</strong>")).toBeInTheDocument();
    expect(table.querySelector("strong")).toBeNull();
  });
});

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
