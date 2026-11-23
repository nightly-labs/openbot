import { Share } from "react-native";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { isIOS } from "@/shared/lib/platform";

const DOWNLOAD_URL = "https://openbot.run/download";

export function shareOpenBot(): void {
  Share.share(isIOS ? { url: DOWNLOAD_URL } : { message: DOWNLOAD_URL }).catch((error: unknown) => {
    supportLog.add("warn", "app", `Share sheet not opened: ${supportLogValue(error)}`);
  });
}
