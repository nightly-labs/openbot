export let callOptions;
export const spoken = [];
export const nativeCall = {
  start: async () => {},
  close() {},
  mute() {},
  interrupt() {},
  speak(text) {
    spoken.push(text);
  },
};
export function createNativeRealtimeVoice(options) {
  callOptions = options;
  return nativeCall;
}
export const nativeRealtimeVoiceAvailable = () => true;
