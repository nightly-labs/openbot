import { join } from "node:path";
import { type AppLogoColor, type AppVariant, DEFAULT_APP_LOGO_COLOR } from "@openbot/contracts/ipc";

const APP_VARIANTS = ["production", "dev", "preview"] as const satisfies readonly AppVariant[];

export function readAppVariant(value: string | undefined, isPackaged: boolean): AppVariant {
  if (isAppVariant(value)) return value;
  return isPackaged ? "production" : "dev";
}

export function appIconFileName(variant: AppVariant, platform: NodeJS.Platform): string {
  return platform === "darwin" ? `icon-${variant}-macos-safe-area.png` : `icon-${variant}.png`;
}

export function resolveAppIconPath(options: {
  variant: AppVariant;
  platform: NodeJS.Platform;
  isPackaged: boolean;
  resourcesPath: string;
  sourceRoot: string;
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, "icons", appIconFileName(options.variant, options.platform))
    : join(options.sourceRoot, "build", appIconFileName(options.variant, options.platform));
}

/**
 * The icon for a logo color. The default color is the release icon itself, so it has no file in
 * `build/logo-colors/`.
 */
export function resolveLogoColorIconPath(options: {
  color: AppLogoColor;
  platform: NodeJS.Platform;
  isPackaged: boolean;
  resourcesPath: string;
  sourceRoot: string;
}): string {
  const { color, ...location } = options;
  if (color === DEFAULT_APP_LOGO_COLOR) return resolveAppIconPath({ ...location, variant: "production" });
  const fileName = options.platform === "darwin" ? `icon-${color}-macos-safe-area.png` : `icon-${color}.png`;
  return options.isPackaged
    ? join(options.resourcesPath, "icons", "logo-colors", fileName)
    : join(options.sourceRoot, "build", "logo-colors", fileName);
}

function isAppVariant(value: string | undefined): value is AppVariant {
  return APP_VARIANTS.some((variant) => variant === value);
}
