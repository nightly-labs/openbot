import { APP_LOGO_CORNER, APP_LOGO_EYE_POINTS, APP_LOGO_SIZE } from "@openbot/brand/app-logo-shape";
import { heatLevel, heatmapMonths, heatmapWeeks, type ProfileStats } from "@openbot/team-client/profile-stats";
import {
  ClipOp,
  ImageFormat,
  matchFont,
  PaintStyle,
  type SkCanvas,
  type SkFont,
  type SkFontMgr,
  Skia,
  StrokeCap,
  StrokeJoin,
} from "@shopify/react-native-skia";
import { File, Paths } from "expo-file-system";
import { APP_FONT } from "@/shared/lib/app-font";
import { currentText } from "@/shared/lib/text";

/*
 * The image of the desktop Share dialog, drawn the same way: the account, the last 26 weeks of
 * activity and four numbers, on the light paper surface. Nothing leaves the phone unless the user
 * sends the file from the share sheet.
 */

const WIDTH = 1200;
const HEIGHT = 690;
const PAD = 56;
const WEEKS = 26;
const AVATAR = 88;
const LOGO = 56;
const GRID = { top: 222, gap: 6 };
const TILES = { top: 548, height: 96, gap: 16, radius: 20 };
/** The opacity of each heatmap level; level 0 is the text colour, the others the accent. */
const LEVEL_ALPHA = [0.07, 0.32, 0.55, 0.78, 1] as const;
/** `--openbot-accent-soft`: the accent at this opacity, behind the initials. */
const ACCENT_SOFT_ALPHA = 0.16;

export interface ProfileShareColors {
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  logo: string;
  logoEye: string;
}

export interface ProfileShareAccount {
  name: string;
  avatarUrl: string | null;
}

type MakeFont = (size: number, weight: "500" | "600") => SkFont;

function fill(color: string, alpha = 1) {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(color));
  if (alpha < 1) paint.setAlphaf(alpha);
  return paint;
}

function textWidth(text: string, typeface: SkFont): number {
  return typeface.measureText(text).width;
}

/** The text, cut with an ellipsis to fit `width`. */
function ellipsize(text: string, typeface: SkFont, width: number): string {
  if (textWidth(text, typeface) <= width) return text;
  let end = text.length;
  while (end > 0 && textWidth(`${text.slice(0, end)}…`, typeface) > width) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "O"
  );
}

/** The account photo; a photo that does not load gives its place to the initials. */
async function loadPhoto(url: string) {
  try {
    return Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(url));
  } catch {
    return null;
  }
}

function eyePath(points: string) {
  const values = points.split(" ").map(Number);
  const path = Skia.PathBuilder.Make();
  for (let index = 0; index + 1 < values.length; index += 2) {
    const x = values[index] ?? 0;
    const y = values[index + 1] ?? 0;
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  return path.build();
}

function drawLogo(canvas: SkCanvas, x: number, y: number, colors: ProfileShareColors): void {
  const scale = LOGO / APP_LOGO_SIZE;
  canvas.save();
  canvas.translate(x, y);
  canvas.scale(scale, scale);
  canvas.drawRRect(
    Skia.RRectXY(Skia.XYWHRect(0, 0, APP_LOGO_SIZE, APP_LOGO_SIZE), APP_LOGO_CORNER, APP_LOGO_CORNER),
    fill(colors.logo),
  );
  const stroke = fill(colors.logoEye);
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setStrokeWidth(9.5);
  stroke.setStrokeCap(StrokeCap.Round);
  stroke.setStrokeJoin(StrokeJoin.Round);
  canvas.drawPath(eyePath(APP_LOGO_EYE_POINTS.left), stroke);
  canvas.drawPath(eyePath(APP_LOGO_EYE_POINTS.right), stroke);
  canvas.restore();
}

async function drawHeader(
  canvas: SkCanvas,
  account: ProfileShareAccount,
  colors: ProfileShareColors,
  font: MakeFont,
): Promise<void> {
  const { t } = currentText();
  const cx = PAD + AVATAR / 2;
  const cy = PAD + AVATAR / 2;
  canvas.save();
  canvas.clipPath(
    Skia.PathBuilder.Make()
      .addCircle(cx, cy, AVATAR / 2)
      .build(),
    ClipOp.Intersect,
    true,
  );
  const photo = account.avatarUrl ? await loadPhoto(account.avatarUrl) : null;
  if (photo) {
    const scale = Math.max(AVATAR / photo.width(), AVATAR / photo.height());
    const width = photo.width() * scale;
    const height = photo.height() * scale;
    canvas.drawImageRect(
      photo,
      Skia.XYWHRect(0, 0, photo.width(), photo.height()),
      Skia.XYWHRect(cx - width / 2, cy - height / 2, width, height),
      fill(colors.surface),
    );
  } else {
    canvas.drawRect(Skia.XYWHRect(PAD, PAD, AVATAR, AVATAR), fill(colors.accent, ACCENT_SOFT_ALPHA));
    const initialsFont = font(32, "600");
    const text = initials(account.name);
    canvas.drawText(text, cx - textWidth(text, initialsFont) / 2, cy + 11, fill(colors.accent), initialsFont);
  }
  canvas.restore();

  const textX = PAD + AVATAR + 24;
  const width = WIDTH - PAD - LOGO - 24 - textX;
  const nameFont = font(40, "600");
  canvas.drawText(ellipsize(account.name, nameFont, width), textX, PAD + 42, fill(colors.text), nameFont);
  canvas.drawText(t("mobile.settings.profile.share.caption"), textX, PAD + 78, fill(colors.muted), font(24, "500"));
  drawLogo(canvas, WIDTH - PAD - LOGO, PAD + (AVATAR - LOGO) / 2, colors);
}

/** The last `WEEKS` columns of the year, Sunday at the top, with the month above its first week. */
function drawWeeks(
  canvas: SkCanvas,
  days: ProfileStats<{ id: string }>["days"],
  colors: ProfileShareColors,
  font: MakeFont,
): void {
  const { format } = currentText();
  const last = days.at(-1);
  const visible = days.slice(-(WEEKS * 7 - (6 - (last?.weekday ?? 6))));
  const weeks = heatmapWeeks(visible);
  const step = (WIDTH - PAD * 2 + GRID.gap) / WEEKS;
  const cell = step - GRID.gap;
  const max = Math.max(0, ...visible.map((day) => day.tokens));

  const monthFont = font(20, "500");
  const monthPaint = fill(colors.muted);
  for (const month of heatmapMonths(weeks)) {
    const label = format.date(Date.parse(`${month.date}T00:00:00Z`), { month: "short", timeZone: "UTC" });
    canvas.drawText(label, PAD + month.week * step, GRID.top - 14, monthPaint, monthFont);
  }

  weeks.forEach((week, column) => {
    week.forEach((day, row) => {
      if (!day) return;
      const level = heatLevel(day, max);
      canvas.drawRRect(
        Skia.RRectXY(Skia.XYWHRect(PAD + column * step, GRID.top + row * step, cell, cell), 6, 6),
        fill(level === 0 ? colors.text : colors.accent, LEVEL_ALPHA[level]),
      );
    });
  });
}

function drawTiles(
  canvas: SkCanvas,
  stats: ProfileStats<{ id: string }>,
  colors: ProfileShareColors,
  font: MakeFont,
): void {
  const { t, format } = currentText();
  const longDate = (date: string) =>
    format.date(Date.parse(`${date}T00:00:00Z`), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const tiles = [
    { label: t("mobile.settings.profile.tile.tokens"), value: format.compact(stats.tokens) },
    {
      label: stats.peak
        ? `${t("mobile.settings.profile.tile.peakDay")} · ${longDate(stats.peak.date)}`
        : t("mobile.settings.profile.tile.peakDay"),
      value: stats.peak ? format.compact(stats.peak.tokens) : "–",
    },
    { label: t("mobile.settings.profile.tile.messages"), value: format.compact(stats.messages) },
    {
      label: t("mobile.settings.profile.tile.currentStreak"),
      value: t("mobile.settings.profile.tile.days", { count: stats.currentStreak }),
    },
  ];
  const width = (WIDTH - PAD * 2 - TILES.gap * (tiles.length - 1)) / tiles.length;
  const border = fill(colors.border);
  border.setStyle(PaintStyle.Stroke);
  border.setStrokeWidth(2);
  const labelFont = font(19, "500");
  const valueFont = font(34, "600");
  tiles.forEach((tile, index) => {
    const x = PAD + index * (width + TILES.gap);
    canvas.drawRRect(
      Skia.RRectXY(Skia.XYWHRect(x + 1, TILES.top + 1, width - 2, TILES.height - 2), TILES.radius, TILES.radius),
      border,
    );
    canvas.drawText(
      ellipsize(tile.label, labelFont, width - 40),
      x + 20,
      TILES.top + 34,
      fill(colors.muted),
      labelFont,
    );
    canvas.drawText(tile.value, x + 20, TILES.top + 76, fill(colors.text), valueFont);
  });
}

/**
 * Draws the activity image and saves it as a PNG file in the cache. The caller deletes the file.
 * Android does not give the fonts of the app to the system font manager, so the caller passes the
 * Inter files in `appFonts`. Without them, Skia uses the system font.
 */
export async function renderProfileShareImage(
  account: ProfileShareAccount,
  stats: ProfileStats<{ id: string }>,
  colors: ProfileShareColors,
  appFonts: SkFontMgr | null,
): Promise<File> {
  const font: MakeFont = (size, weight) =>
    matchFont({ fontFamily: APP_FONT, fontSize: size, fontWeight: weight }, appFonts ?? undefined);
  const surface = Skia.Surface.Make(WIDTH, HEIGHT);
  if (!surface) throw new Error("The activity image cannot be drawn.");
  const canvas = surface.getCanvas();
  canvas.drawRect(Skia.XYWHRect(0, 0, WIDTH, HEIGHT), fill(colors.surface));
  await drawHeader(canvas, account, colors, font);
  drawWeeks(canvas, stats.days, colors, font);
  drawTiles(canvas, stats, colors, font);
  surface.flush();
  const file = new File(Paths.cache, currentText().t("mobile.settings.profile.share.fileName"));
  if (file.exists) file.delete();
  file.writeSync(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  return file;
}
