import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "選択",
  "mobile.shared.crop.label": "写真の切り抜き",
  "mobile.shared.crop.hint": "ドラッグして写真を移動し、ピンチして拡大・縮小します。",
  "mobile.shared.splash.loading": "アカウントを読み込んでいます",
  "mobile.shared.photo.openFailed": "この写真を開けませんでした。もう一度お試しください。",
  "mobile.shared.photo.tooLarge":
    "OpenBot はこの写真を十分に小さくできませんでした。よりシンプルな写真を選んでください。",
  "mobile.shared.save.changes": "変更を保存",
} as const satisfies PartialTranslation<typeof source>;
