import { MarkdownMessageText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { render } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";

// KaTeX output goes into the page as HTML, and a message can come from another member of a team.
it("typesets math from a message without links, images or event handlers from its source", () => {
  const body = [
    "$\\href{javascript:alert(1)}{x}$ and $\\url{javascript:alert(2)}$",
    "$\\includegraphics{https://example.com/a.png}$ and $\\htmlData{onclick=alert(3)}{y}$",
    '$\\text{<img src=x onerror="alert(4)">}$ and $P(A) + P(A^c) = 1$',
  ].join("\n\n");
  const { container } = render(() => (
    <MarkdownMessageText body={body} agents={[]} onSelectAgent={vi.fn()} onOpenLink={vi.fn()} />
  ));

  // KaTeX hides its HTML from assistive technology, so role queries do not see into it.
  expect(container.querySelectorAll("a, img")).toHaveLength(0);
  const attributes = [...container.querySelectorAll("*")].flatMap((element) => element.getAttributeNames());
  expect(attributes.filter((name) => name.startsWith("on"))).toEqual([]);
  expect(container.querySelectorAll("math")).toHaveLength(6);
});
