const STORAGE_KEY = "openbot:voice-language-notice";

export function claimVoiceLanguageNotice(): boolean {
  try {
    if (window.localStorage.getItem(STORAGE_KEY) !== null) return false;
    window.localStorage.setItem(STORAGE_KEY, "shown");
    return true;
  } catch {
    return false;
  }
}
