const DARK_TEXT = "#141414";
const LIGHT_TEXT = "#ffffff";

export function readableOn(fill: string) {
  const hex = fill.replace("#", "");
  if (!/^[0-9a-f]{6}/i.test(hex)) return LIGHT_TEXT;
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  const againstWhite = 1.05 / (luminance + 0.05);
  const againstDark = (luminance + 0.05) / 0.0556;
  return againstDark > againstWhite ? DARK_TEXT : LIGHT_TEXT;
}
