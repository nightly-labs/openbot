import { NativeModules } from "react-native";

/**
 * `react-native-webrtc`, for GPT live voice. Null in a build without its native module, such as Expo
 * Go or an app binary from before it, which an update can still reach: the library throws when it
 * loads there, so it loads only when the module exists. The chat then keeps the voice conversation
 * of the phone, and Settings does not show GPT live voice.
 */
export const liveVoiceWebRtc: typeof import("react-native-webrtc") | null = NativeModules.WebRTCModule
  ? require("react-native-webrtc")
  : null;
