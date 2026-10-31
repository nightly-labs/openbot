import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "Драйвер керування комп’ютером не запустився. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "Драйвер керування комп’ютером зупинився, не встигнувши відповісти.",
  "status.computerUse.driverNoAnswer": "Драйвер керування комп’ютером не відповів. {reason}",
  "status.computerUse.driverStopped": "Драйвер керування комп’ютером зупинено.",
  "status.computerUse.unsupported": "Керування комп’ютером доступне в macOS, Windows і Linux.",
  "status.computerUse.driverMissing": "У цій збірці OpenBot немає драйвера керування комп’ютером.",
  "status.computerUse.progressActing": "Працюю із застосунком на цьому комп’ютері…",
  "status.computerUse.progressDeciding": "Вибираю наступний крок у застосунку…",
} as const satisfies PartialTranslation<typeof source>;
