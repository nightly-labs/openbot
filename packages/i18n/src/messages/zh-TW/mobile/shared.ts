import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "選擇",
  "mobile.shared.crop.label": "照片裁切",
  "mobile.shared.crop.hint": "拖動可移動照片，雙指捏合可縮放。",
  "mobile.shared.splash.loading": "正在載入帳號",
  "mobile.shared.photo.openFailed": "無法開啟這張照片，請重試。",
  "mobile.shared.photo.tooLarge": "OpenBot 無法把這張照片壓到足夠小，請換一張更簡單的照片。",
  "mobile.shared.save.changes": "儲存更改",
} as const satisfies PartialTranslation<typeof source>;
