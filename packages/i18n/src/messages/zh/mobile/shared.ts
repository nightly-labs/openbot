import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "选择",
  "mobile.shared.crop.label": "照片裁切",
  "mobile.shared.crop.hint": "拖动可移动照片，双指捏合可缩放。",
  "mobile.shared.splash.loading": "正在加载账号",
  "mobile.shared.photo.openFailed": "无法打开这张照片，请重试。",
  "mobile.shared.photo.tooLarge": "OpenBot 无法把这张照片压到足够小，请换一张更简单的照片。",
  "mobile.shared.save.changes": "保存更改",
} as const satisfies PartialTranslation<typeof source>;
