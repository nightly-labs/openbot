import { describe, expect, it } from "vitest";
import { markdownListLineBreak } from "./markdown-lists";

function breakAtEnd(text: string) {
  return markdownListLineBreak(text, text.length);
}

describe("markdown list line breaks", () => {
  it("continues bullet, numbered, nested and task items", () => {
    expect(breakAtEnd("- milk")).toEqual({ text: "- milk\n- ", caret: 9 });
    expect(breakAtEnd("Buy:\n* milk")).toEqual({ text: "Buy:\n* milk\n* ", caret: 14 });
    expect(breakAtEnd("9. milk")?.text).toBe("9. milk\n10. ");
    expect(breakAtEnd("1) milk")?.text).toBe("1) milk\n2) ");
    expect(breakAtEnd("- a\n  - b")?.text).toBe("- a\n  - b\n  - ");
    expect(breakAtEnd("- [x] done")?.text).toBe("- [x] done\n- [ ] ");
  });

  it("moves the text after the caret into the next item", () => {
    expect(markdownListLineBreak("- milk eggs\nend", 7)).toEqual({ text: "- milk \n- eggs\nend", caret: 10 });
  });

  it("ends the list on an empty item and keeps the next line break plain", () => {
    expect(breakAtEnd("- milk\n- ")).toEqual({ text: "- milk\n", caret: 7 });
    expect(breakAtEnd("- milk\n- [ ] ")?.text).toBe("- milk\n");
    expect(breakAtEnd("- milk\n")).toBeNull();
  });

  it("keeps plain line breaks outside list items", () => {
    expect(breakAtEnd("plain text")).toBeNull();
    expect(breakAtEnd("-no space")).toBeNull();
    expect(breakAtEnd("- - -")).toBeNull();
    expect(markdownListLineBreak("- milk", 1)).toBeNull();
    expect(breakAtEnd("```\n- milk")).toBeNull();
    expect(breakAtEnd("```\ncode\n```\n- milk")?.text).toBe("```\ncode\n```\n- milk\n- ");
    expect(breakAtEnd("- ```\n  code\n- milk")?.text).toBe("- ```\n  code\n- milk\n- ");
    expect(breakAtEnd("````\n```\n- milk")).toBeNull();
    expect(breakAtEnd("~~~\n```\n- milk")).toBeNull();
    expect(breakAtEnd("- item\n\n    ```\n    - literal")).toBeNull();
    expect(breakAtEnd("- ```\n  - literal")).toBeNull();
    expect(breakAtEnd("  ```\n- milk")).toBeNull();
    expect(breakAtEnd("~~~\n- ~~~\n- literal")).toBeNull();
  });
});
