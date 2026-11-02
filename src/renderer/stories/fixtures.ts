export * from "../src/preview/fixtures";

/** A message with each kind of Markdown that a reply quote renders, and raw HTML that it must not. */
export const STORY_REPLY_QUOTE_BODY = [
  "## Launch plan",
  "",
  "I asked **Build** to run `bun run check` before the tag. See [the release guide](https://openbot.run/docs).",
  "",
  "- Tag `v0.47.0`",
  "- Publish <b>the notes</b>",
  "",
  "```bash",
  "bun run check",
  "```",
].join("\n");
