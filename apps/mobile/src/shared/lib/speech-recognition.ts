import { requireOptionalNativeModule } from "expo";
import type { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

/**
 * Null where the native module is missing, such as Expo Go. The package entry
 * requires the module and would crash there on import, so the chat hides
 * dictation instead.
 */
export const speechRecognition =
  requireOptionalNativeModule<typeof ExpoSpeechRecognitionModule>("ExpoSpeechRecognition");
