/**
 * The colors of code, tables and chips in a bubble with a message color. They follow the text color
 * of the bubble, not the app theme: on a dark color with white text the surfaces are darker, and on
 * a light color with dark text they are lighter, so the text on them stays readable. Each surface is
 * a clear layer, so it takes the hue of the bubble and follows its fade while the chat is not
 * connected.
 */
export interface BubbleTone {
  /** The text on the bubble, and the code in it. */
  foreground: string;
  /** Code comments, table headers and the language of a code block. */
  muted: string;
  /** Code blocks, inline code, code preview cards and the card of a table. */
  panel: string;
  /** The rows of a table, one step further from the bubble than the card. */
  deep: string;
  /** Mention chips. */
  chip: string;
  /** The lines between the rows of a table and the border of a code preview card. */
  line: string;
}

/** True when an `#rrggbb` text color is light, so the bubble under it is dark. */
function isLight(color: string): boolean {
  const channel = (offset: number) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5) > 0.5;
}

export function bubbleTone(foreground: string): BubbleTone {
  const dark = isLight(foreground);
  const layer = dark ? "#000000" : "#ffffff";
  return {
    foreground,
    muted: `${foreground}b3`,
    panel: `${layer}${dark ? "4d" : "59"}`,
    deep: `${layer}${dark ? "70" : "6b"}`,
    chip: `${layer}${dark ? "40" : "47"}`,
    line: `${foreground}17`,
  };
}
