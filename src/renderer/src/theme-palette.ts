import type { AppThemePalette } from "@openbot/contracts/app-appearance";

function clear(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

function mix(color: string, other: string, percent: number): string {
  return `color-mix(in srgb, ${color}, ${other} ${percent}%)`;
}

function paletteTokens({ scheme, colors }: AppThemePalette): Record<string, string> {
  const raised = scheme === "light" ? mix(colors.canvas, "#ffffff", 70) : colors.surface;
  const tabsBar = scheme === "light" ? mix(colors.canvas, colors.surface, 30) : colors.surface;
  return {
    "--openbot-bg-canvas": colors.canvas,
    "--openbot-bg-canvas-clear": clear(colors.canvas, 0),
    "--openbot-bg-frame": colors.frame,
    "--openbot-bg-sidebar": colors.sidebar,
    "--openbot-bg-native-sidebar": colors.sidebar,
    "--openbot-bg-sheet": raised,
    "--openbot-bg-sheet-inset": colors.frame,
    "--openbot-bg-grouped": raised,
    "--openbot-bg-surface": raised,
    "--openbot-bg-surface-raised": mix(raised, colors.text, 3),
    "--openbot-bg-control": raised,
    "--openbot-bg-control-hover": mix(raised, colors.text, 4),
    "--openbot-bg-control-active": mix(raised, colors.text, 8),
    "--openbot-tabs-bar-bg": tabsBar,
    "--openbot-tabs-pill-bg": scheme === "light" ? raised : mix(colors.surface, colors.text, 8),
    "--openbot-marketplace-detail-bg": colors.frame,
    "--openbot-bg-overlay": clear(colors.canvas, 92),
    "--openbot-bg-glass": clear(raised, 76),
    "--openbot-scroll-edge-overlay": clear(colors.canvas, 72),

    "--openbot-border": clear(colors.border, 35),
    "--openbot-border-strong": clear(colors.border, 50),
    "--openbot-border-grouped": colors.border,
    "--openbot-dialog-ring": clear(colors.border, 70),
    "--openbot-image-outline": clear(colors.border, 60),
    "--openbot-hover": clear(colors.text, 5),

    "--openbot-text-primary": colors.text,
    "--openbot-text-secondary": mix(colors.text, colors.textMuted, 25),
    "--openbot-text-muted": colors.textMuted,
    "--openbot-text-dim": mix(colors.textMuted, colors.canvas, 30),
    "--openbot-text-placeholder": colors.textMuted,
    "--openbot-text-readable": colors.textMuted,
    "--openbot-text-grouped-secondary": colors.textMuted,
    "--openbot-settings-text-muted": colors.textMuted,

    "--openbot-surface-light": colors.text,
    "--openbot-text-on-light": colors.canvas,
    "--openbot-text-muted-on-light": clear(colors.canvas, 64),
    "--openbot-text-dim-on-light": clear(colors.canvas, 40),
    "--openbot-border-on-light": clear(colors.canvas, 16),

    "--openbot-accent": colors.accent,
    "--openbot-accent-hover": mix(colors.accent, colors.text, 15),
    "--openbot-accent-text": colors.accent,
    "--openbot-accent-soft": clear(colors.accent, 16),
    "--openbot-accent-strong": clear(colors.accent, 34),
    "--openbot-text-on-accent": colors.accentForeground,

    "--openbot-success": colors.success,
    "--openbot-success-text": colors.success,
    "--openbot-success-soft": clear(colors.success, 14),
    "--openbot-success-wash": clear(colors.success, 6),
    "--openbot-warning": colors.warning,
    "--openbot-warning-text": colors.warning,
    "--openbot-warning-soft": clear(colors.warning, 14),
    "--openbot-danger": colors.danger,
    "--openbot-danger-hover": mix(colors.danger, colors.text, 15),
    "--openbot-danger-text": colors.danger,
    "--openbot-danger-soft": clear(colors.danger, 14),
    "--openbot-danger-soft-hover": clear(colors.danger, 22),
    "--openbot-danger-focus": clear(colors.danger, 36),
    "--openbot-danger-border": clear(colors.danger, 45),
  };
}

let applied: string[] = [];

export function applyThemePalette(palette: AppThemePalette | null): void {
  const style = document.documentElement.style;
  for (const name of applied) style.removeProperty(name);
  applied = [];
  if (palette === null) return;
  for (const [name, value] of Object.entries(paletteTokens(palette))) {
    style.setProperty(name, value);
    applied.push(name);
  }
}
