export interface BubbleTone {
  foreground: string;
  muted: string;
  panel: string;
  deep: string;
  chip: string;
  line: string;
}

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
