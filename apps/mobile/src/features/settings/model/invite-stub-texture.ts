import {
  BlendMode,
  FontWeight,
  type SkCanvas,
  type SkImage,
  Skia,
  type SkTypefaceFontProvider,
} from "@shopify/react-native-skia";
import { APP_FONT } from "@/shared/lib/app-font";

export interface StubBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StubPart = "row" | "column" | "admit" | "link" | "hint";
export type StubParts = Record<StubPart, StubBox>;

export interface InviteStubTextureInput {
  width: number;
  height: number;
  scale: number;
  admit: string;
  link: string;
  hint: string;
  parts: StubParts;
  lineWidths: Partial<Record<StubLine, number>>;
  fontScale: number;
  colors: StubColors;
  fonts: SkTypefaceFontProvider;
}

export type StubLine = "admit" | "link" | "hint";

const INVITE_STUB_LAYOUT = {
  notch: 24,
  hole: 7,
  holes: 18,
  holeInset: 18,
  radius: 22,
} as const;

export interface StubColors {
  paper: string;
  ink: string;
  muted: string;
  hole: string | null;
}

export const STUB_COLORS: Record<"light" | "dark", StubColors> = {
  light: { paper: "#ffffff", ink: "#1d1822", muted: "rgba(29,24,34,0.55)", hole: null },
  dark: { paper: "#f6f1ea", ink: "#1d1822", muted: "rgba(29,24,34,0.55)", hole: null },
};

function fill(color: string) {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(color));
  return paint;
}

interface LineStyle {
  size: number;
  weight: FontWeight;
  color: string;
  spacing?: number;
  lineHeight: number;
}

function fittedParagraph(
  text: string,
  fonts: SkTypefaceFontProvider,
  style: LineStyle,
  width: number,
  fontScale: number,
  target: number | undefined,
) {
  const scaled = { ...style, size: style.size * fontScale, spacing: (style.spacing ?? 0) * fontScale };
  const first = paragraph(text, fonts, scaled, width);
  const drawn = first.getLongestLine();
  if (!target || drawn <= 0 || Math.abs(target / drawn - 1) < 0.004) return first;
  const ratio = target / drawn;
  return paragraph(text, fonts, { ...scaled, size: scaled.size * ratio, spacing: scaled.spacing * ratio }, width);
}

function paragraph(text: string, fonts: SkTypefaceFontProvider, style: LineStyle, width: number) {
  const builder = Skia.ParagraphBuilder.Make({ maxLines: 1, ellipsis: "…" }, fonts);
  builder.pushStyle({
    color: Skia.Color(style.color),
    fontSize: style.size,
    fontFamilies: [APP_FONT],
    fontStyle: { weight: style.weight },
    letterSpacing: style.spacing ?? 0,
    heightMultiplier: style.lineHeight / style.size,
    halfLeading: true,
  });
  builder.addText(text);
  const result = builder.build();
  result.layout(width);
  return result;
}

function drawPaper(canvas: SkCanvas, width: number, height: number, paper: string, hole: string | null) {
  const { radius, notch, hole: size, holes, holeInset } = INVITE_STUB_LAYOUT;
  const outline = Skia.Path.MakeFromSVGString(
    `M0 0 H${width} V${height - radius} A${radius} ${radius} 0 0 1 ${width - radius} ${height} H${radius} A${radius} ${radius} 0 0 1 0 ${height - radius} Z`,
  );
  if (outline) canvas.drawPath(outline, fill(paper));
  const clear = Skia.Paint();
  clear.setAntiAlias(true);
  clear.setBlendMode(BlendMode.Clear);
  const holePaint = hole ? fill(hole) : clear;
  canvas.drawCircle(0, 0, notch / 2, holePaint);
  canvas.drawCircle(width, 0, notch / 2, holePaint);
  const first = holeInset + size / 2;
  const last = width - holeInset - size / 2;
  for (let index = 0; index < holes; index += 1) {
    canvas.drawCircle(first + ((last - first) * index) / (holes - 1), 0, size / 2, holePaint);
  }
}

export function renderInviteStubTexture(input: InviteStubTextureInput): SkImage | null {
  const { width, height, scale, fonts } = input;
  if (width <= 0 || height <= 0) return null;
  const surface = Skia.Surface.Make(Math.ceil(width * scale), Math.ceil(height * scale));
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.scale(scale, scale);
  drawPaper(canvas, width, height, input.colors.paper, input.colors.hole);
  const { row, column } = input.parts;
  const left = row.x + column.x;
  const top = row.y + column.y;
  const lines = [
    {
      key: "admit" as const,
      box: input.parts.admit,
      text: input.admit.toUpperCase(),
      size: 11,
      weight: FontWeight.SemiBold,
      color: input.colors.ink,
      spacing: 2,
    },
    {
      key: "link" as const,
      box: input.parts.link,
      text: input.link,
      size: 16,
      weight: FontWeight.SemiBold,
      color: input.colors.ink,
    },
    {
      key: "hint" as const,
      box: input.parts.hint,
      text: input.hint,
      size: 12,
      weight: FontWeight.Normal,
      color: input.colors.muted,
    },
  ];
  for (const line of lines) {
    const text = fittedParagraph(
      line.text,
      fonts,
      { ...line, lineHeight: line.box.height },
      column.width,
      input.fontScale,
      input.lineWidths[line.key],
    );
    text.paint(canvas, left + line.box.x, top + line.box.y);
  }
  surface.flush();
  return surface.makeImageSnapshot();
}
