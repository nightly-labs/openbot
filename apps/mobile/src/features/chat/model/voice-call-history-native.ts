import * as LockedKeychain from "@/shared/lib/locked-keychain";
import { createVoiceCallHistory } from "./voice-call-history";

const key = "openbot.mobile.voice-call-history.v1";
export const voiceCallHistory = createVoiceCallHistory({
  read: () => LockedKeychain.getItemAsync(key),
  write: (value) => LockedKeychain.setItemAsync(key, value),
  remove: () => LockedKeychain.deleteItemAsync(key),
});
