import type { AgentMessage } from "@openbot/ui/data";
import { MessageBody } from "@openbot/ui/features/conversation/MessageRendering";
import { render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("MessageBody", () => {
  it("keeps the earlier blocks of a streaming reply in place, so a selection in them stays", () => {
    // Reduced motion shows each update at once instead of one word at a time.
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    const opening =
      "Intro paragraph.\n\n- First point\n- Second point\n\n> A quoted line\n\n```ts\nconst answer = 42;\n```\n\nThe tail";
    const [message, setMessage] = createSignal<AgentMessage>({
      id: "reply",
      author: "agent",
      body: opening,
      time: "10:00",
      streaming: true,
    });
    render(() => (
      <MessageBody
        message={message()}
        agents={[]}
        onSelectAgent={vi.fn()}
        onOpenLink={vi.fn()}
        onPreview={vi.fn()}
        onAttachmentAction={vi.fn()}
      />
    ));
    const intro = screen.getByText("Intro paragraph.");
    const point = screen.getByText("Second point");
    const code = screen.getByRole("region", { name: "TypeScript code block" });

    setMessage({ ...message(), body: `${opening} grows longer.` });
    flush();

    expect(screen.getByText("The tail grows longer.")).toBeInTheDocument();
    expect(screen.getByText("Intro paragraph.")).toBe(intro);
    expect(screen.getByText("Second point")).toBe(point);
    expect(screen.getByRole("region", { name: "TypeScript code block" })).toBe(code);
  });
});
