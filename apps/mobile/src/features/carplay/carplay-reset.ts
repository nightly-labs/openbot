import { currentText } from "@/shared/lib/text";
import { carPlay, carPlaySupported } from "./carplay-native";
import { signedOutCarPlayHome } from "./model/carplay-home";
import { deleteServerCarPlayPictures, resetCarPlayPictures } from "./model/carplay-pictures";
import { deleteServerCarPlayVoiceFrames, resetCarPlayVoiceFrames } from "./model/carplay-voice-pictures";

export function resetCarPlay(): void {
  if (!carPlaySupported) return;
  carPlay.setHome(signedOutCarPlayHome(currentText().t));
  resetCarPlayPictures();
  resetCarPlayVoiceFrames();
}

export function deleteServerCarPlayData(serverId: string): void {
  if (!carPlaySupported) return;
  deleteServerCarPlayPictures(serverId);
  deleteServerCarPlayVoiceFrames(serverId);
}
