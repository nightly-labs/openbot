import { mobileTranslateFor } from "@openbot/i18n/mobile";
import { describe, expect, it } from "vitest";
import {
  applyDictationResult,
  type ComposerControlsInput,
  composerAction,
  dictationDraft,
  dictationLanguageOptions,
  emptyDictationTranscript,
  pickRecognitionLocale,
  retriesWithSystemService,
  spokenText,
} from "./voice-dictation";

const t = mobileTranslateFor("en");

const idle: ComposerControlsInput = {
  disabled: false,
  hasDraft: false,
  busy: false,
  canStop: false,
  stopping: false,
  voiceAvailable: true,
  dictation: "idle",
};

describe("composer action", () => {
  it("dictates into an empty composer, sends a draft, and stops a running turn", () => {
    expect(composerAction(idle)).toMatchObject({ mode: "dictate", pressable: true, primed: false });
    expect(composerAction({ ...idle, hasDraft: true })).toMatchObject({ mode: "send", pressable: true });
    // Stop wins over the mic, so a running turn stays one press from stopping.
    expect(composerAction({ ...idle, canStop: true })).toMatchObject({ mode: "stop", pressable: true });
    // A draft typed or dictated during a turn is queued, so the control sends it.
    expect(composerAction({ ...idle, canStop: true, hasDraft: true }).mode).toBe("send");
    expect(composerAction({ ...idle, disabled: true })).toMatchObject({ mode: "dictate", pressable: false });
  });

  it("keeps the send control without speech recognition or during a send", () => {
    expect(composerAction({ ...idle, voiceAvailable: false })).toMatchObject({ mode: "send", pressable: false });
    expect(composerAction({ ...idle, busy: true })).toMatchObject({ mode: "send", pressable: false, spinner: true });
  });

  it("holds the control for dictation, even with a draft or a running turn", () => {
    for (const input of [{}, { hasDraft: true }, { canStop: true }]) {
      expect(composerAction({ ...idle, ...input, dictation: "listening" })).toMatchObject({
        mode: "finish-dictation",
        pressable: true,
        spinner: false,
      });
    }
    for (const dictation of ["starting", "stopping"] as const) {
      expect(composerAction({ ...idle, dictation })).toMatchObject({
        mode: "finish-dictation",
        pressable: false,
        spinner: true,
      });
    }
  });
});

describe("dictated text", () => {
  it("keeps Android's final segments and replaces the partial result", () => {
    let transcript = applyDictationResult(emptyDictationTranscript, { isFinal: false, text: "hello" });
    transcript = applyDictationResult(transcript, { isFinal: true, text: "hello there" });
    transcript = applyDictationResult(transcript, { isFinal: false, text: "how" });
    transcript = applyDictationResult(transcript, { isFinal: false, text: "how are you" });
    expect(spokenText(transcript)).toBe("hello there how are you");
  });

  it("replaces iOS cumulative partial results with the one final result", () => {
    let transcript = applyDictationResult(emptyDictationTranscript, { isFinal: false, text: "Fix the" });
    transcript = applyDictationResult(transcript, { isFinal: false, text: "Fix the build" });
    transcript = applyDictationResult(transcript, { isFinal: true, text: "Fix the build." });
    expect(spokenText(transcript)).toBe("Fix the build.");
  });

  it("puts the speech after the existing draft with one space", () => {
    expect(dictationDraft("", "hello")).toBe("hello");
    expect(dictationDraft("Note:", "hello")).toBe("Note: hello");
    expect(dictationDraft("Line\n", "hello")).toBe("Line\nhello");
    expect(dictationDraft("Keep me", "")).toBe("Keep me");
  });
});

describe("recognition locale", () => {
  it("takes the first language in the phone's list that the recognizer supports", () => {
    expect(pickRecognitionLocale(["pl-PL"], ["en-US", "pl-PL"])).toBe("pl-PL");
    expect(pickRecognitionLocale(["en_GB"], ["en-GB", "en-US"])).toBe("en-GB");
    // iOS can list a language without a region.
    expect(pickRecognitionLocale(["pl"], ["en-US", "pl-PL"])).toBe("pl-PL");
    // A language the recognizer lacks gives way to the next one the user speaks.
    expect(pickRecognitionLocale(["szl-PL", "pl-PL", "en-US"], ["en-US", "pl-PL"])).toBe("pl-PL");
    // A script subtag does not hide the region.
    expect(pickRecognitionLocale(["zh-Hant-HK"], ["zh-CN", "zh-HK", "zh-TW"])).toBe("zh-HK");
    // A region the recognizer lacks falls back to the language's home region, not the first listed.
    expect(pickRecognitionLocale(["en-PL"], ["en-AE", "en-GB", "en-US"])).toBe("en-US");
    expect(pickRecognitionLocale(["de-LU"], ["de-AT", "de-CH", "de-DE"])).toBe("de-DE");
    // Android 12 lists nothing and takes the first language as given.
    expect(pickRecognitionLocale(["pl-PL", "en-US"], [])).toBe("pl-PL");
  });

  it("lists each language once, by name, and keeps a stored one the recognizer no longer lists", () => {
    const options = dictationLanguageOptions(["pl-PL", "en-US", "en_US"], "de-DE", t);
    expect(options.map((option) => option.value).sort()).toEqual(["de-DE", "en-US", "pl-PL"]);
    expect(options.map((option) => option.label)).toEqual([
      "English (United States)",
      "German (Germany)",
      "Polish (Poland)",
    ]);
    expect(
      dictationLanguageOptions(["zh-Hans-CN", "yue-CN", "es-419", "xx-YY"], null, t).map((option) => option.label),
    ).toEqual(["Cantonese (China mainland)", "Chinese (China mainland)", "Spanish (Latin America)", "xx-YY"]);
    expect(dictationLanguageOptions(["pl-PL"], null, t).map((option) => option.value)).toEqual(["pl-PL"]);
  });
});

describe("on-device fallback", () => {
  it("retries recognizer failures only, not a stop, silence, permission, language or network", () => {
    for (const code of ["audio-capture", "service-not-allowed", "client", "unknown"] as const) {
      expect(retriesWithSystemService(code)).toBe(true);
    }
    for (const code of [
      "aborted",
      "no-speech",
      "speech-timeout",
      "not-allowed",
      "interrupted",
      "busy",
      "language-not-supported",
      "network",
    ] as const) {
      expect(retriesWithSystemService(code)).toBe(false);
    }
  });
});
