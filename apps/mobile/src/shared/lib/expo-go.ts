import { isRunningInExpoGo } from "expo";
import { isAndroid } from "@/shared/lib/platform";

export function expoGoOnAndroid(): boolean {
  return isAndroid && isRunningInExpoGo();
}
