export const starts = [];
export const desktopAnalytics = { track() {}, scope: () => ({ track() {} }) };
export const currentText = () => ({ t: (key) => key, errorMessage: (_error, fallback) => fallback });
export const speechPort = () => ({
  voice: { getServer: async () => null, getSpeechModelStatus: async () => ({ phase: "ready" }) },
});
export const SPEECH_LEVEL_COUNT = 24;
export const speechReading = () => null;
export const onDictatedReplyEnd = () => () => {};
export const dropDictatedReply = () => {};
export const forgetDictatedMessage = () => {};
export const noteDictatedMessage = () => {};
export const createRealtimeVoiceConversation = () => ({
  start: async () => {
    starts.push(true);
  },
  dispose() {},
  phase: () => "listening",
});

export const skillExamplePrompt = () => "";

export const toast = { error() {} };
