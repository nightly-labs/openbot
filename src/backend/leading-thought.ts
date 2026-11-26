const THOUGHT_TAGS: readonly (readonly [open: string, close: string])[] = [
  ["<think>", "</think>"],
  ["<thinking>", "</thinking>"],
];

export interface LeadingThoughtSplit {
  readonly thought: string;
  readonly answer: string;
}

const HELD: LeadingThoughtSplit = { thought: "", answer: "" };

export class LeadingThoughtSplitter {
  messageId: string | null = null;
  #state: "lead" | "inside" | "after" | "answer" = "lead";
  #held = "";
  #moved = "";
  #close = "";
  #searchFrom = 0;

  get hidden(): string {
    return this.#moved + this.#held;
  }

  feed(text: string): LeadingThoughtSplit {
    if (this.#state === "answer") return { thought: "", answer: text };
    this.#held += text;
    if (this.#state === "lead") {
      const start = this.#held.length - this.#held.trimStart().length;
      const lead = this.#held.slice(start);
      if (!lead) return HELD;
      const tag = THOUGHT_TAGS.find(([open]) => lead.startsWith(open));
      if (!tag) {
        if (THOUGHT_TAGS.some(([open]) => open.startsWith(lead))) return HELD;
        return { thought: "", answer: this.release() };
      }
      const opened = start + tag[0].length;
      this.#moved = this.#held.slice(0, opened);
      this.#held = this.#held.slice(opened);
      this.#close = tag[1];
      this.#searchFrom = 0;
      this.#state = "inside";
    }
    let thought = "";
    if (this.#state === "inside") {
      const end = this.#held.indexOf(this.#close, this.#searchFrom);
      if (end < 0) {
        this.#searchFrom = Math.max(0, this.#held.length - this.#close.length + 1);
        return HELD;
      }
      const closed = end + this.#close.length;
      thought = this.#held.slice(0, end).trim();
      this.#moved += this.#held.slice(0, closed);
      this.#held = this.#held.slice(closed);
      this.#state = "after";
    }
    const answer = this.#held.trimStart();
    this.#moved += this.#held.slice(0, this.#held.length - answer.length);
    this.#held = "";
    if (answer) this.#state = "answer";
    return { thought, answer };
  }

  release(): string {
    const released = this.#state === "inside" ? this.#moved + this.#held : this.#held;
    if (this.#state === "inside") this.#moved = "";
    this.#held = "";
    this.#state = "answer";
    return released;
  }
}

export function splitLeadingThought(text: string): LeadingThoughtSplit | null {
  const splitter = new LeadingThoughtSplitter();
  const split = splitter.feed(text);
  const answer = split.answer + splitter.release();
  return splitter.hidden ? { thought: split.thought, answer } : null;
}
