import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "میزبان محلی OpenBot",
  "window.localClientTitle": "کارخواه محلی OpenBot",
  "window.computerUsePermissionTitle": "فعال‌کردن استفاده از رایانه",
} as const satisfies PartialTranslation<typeof source>;
