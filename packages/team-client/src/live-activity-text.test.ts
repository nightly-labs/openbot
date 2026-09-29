import { describe, expect, it } from "vitest";
import { liveActivityMarkdown } from "./live-activity-text";

describe("Live Activity text", () => {
  it("makes one line of inline Markdown from blocks", () => {
    const message = [
      "# Nagłówek 1",
      "## Nagłówek 2",
      "Zwykły tekst z **pogrubieniem** i [linkiem](https://openbot.run).",
      "- pierwszy",
      "- [x] zrobione",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");

    expect(liveActivityMarkdown(message, 500)).toBe(
      "**Nagłówek 1** **Nagłówek 2** Zwykły tekst z **pogrubieniem** i linkiem. • pierwszy ☑ zrobione A · B 1 · 2 `const x = 1;`",
    );
  });

  it("writes math as Unicode and keeps amounts and code as text", () => {
    expect(liveActivityMarkdown("Wynik $x^2 + \\alpha_i \\le \\frac{a+b}{2}$ gotowy", 500)).toBe(
      "Wynik x² + αᵢ ≤ (a+b)/2 gotowy",
    );
    expect(liveActivityMarkdown("$$\\sqrt{n} \\cdot \\pi$$", 500)).toBe("√n · π");
    expect(liveActivityMarkdown("Koszt $5 i $10, `a_b $x$`", 500)).toBe("Koszt $5 i $10, `a_b $x$`");
  });

  it("closes the marks that a cut leaves open", () => {
    expect(liveActivityMarkdown(`Tekst **${"b".repeat(40)}** koniec`, 20)).toBe(`Tekst **${"b".repeat(13)}…**`);
  });
});
