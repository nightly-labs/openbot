import { NativeModules } from "react-native";

export const liveVoiceWebRtc: typeof import("react-native-webrtc") | null = NativeModules.WebRTCModule
  ? require("react-native-webrtc")
  : null;
