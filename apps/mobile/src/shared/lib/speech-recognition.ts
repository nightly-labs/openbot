import { requireOptionalNativeModule } from "expo";
import type { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

export const speechRecognition =
  requireOptionalNativeModule<typeof ExpoSpeechRecognitionModule>("ExpoSpeechRecognition");
