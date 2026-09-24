import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useVoiceDictation, type VoiceDictation } from "./use-voice-dictation";

const native = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    listeners,
    emit(name: string, event: unknown = null) {
      for (const listener of listeners.get(name) ?? []) listener(event);
    },
    alert: vi.fn(),
    phoneLanguages: ["en-US"],
    foreground: true,
    dictationLanguage: "automatic",
    module: {
      addListener(name: string, listener: (event: unknown) => void) {
        const set = listeners.get(name) ?? new Set();
        set.add(listener);
        listeners.set(name, set);
        return { remove: () => set.delete(listener) };
      },
      isRecognitionAvailable: vi.fn(() => true),
      supportsOnDeviceRecognition: vi.fn(() => true),
      getSupportedLocales: vi.fn(
        async (): Promise<{ locales: string[]; installedLocales: string[] }> => ({
          locales: ["en-US"],
          installedLocales: [],
        }),
      ),
      requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    },
  };
});
vi.mock("@/shared/lib/speech-recognition", () => ({ speechRecognition: native.module }));
vi.mock("@/shared/lib/platform", () => ({ isIOS: false }));
vi.mock("@/shared/lib/phone-languages", () => ({ phoneLanguages: () => native.phoneLanguages }));
vi.mock("@/features/settings/model/dictation-language", () => ({
  AUTOMATIC_DICTATION_LANGUAGE: "automatic",
  useDictationLanguage: { getState: () => ({ value: native.dictationLanguage }) },
}));
vi.mock("@/shared/lib/use-app-foreground", () => ({ useAppForeground: () => native.foreground }));
vi.mock("@/shared/lib/haptics", () => ({
  haptics: { impact: vi.fn(), selection: vi.fn(), notification: vi.fn() },
}));
vi.mock("react-native", () => ({ Alert: { alert: native.alert }, Linking: { openSettings: vi.fn() } }));
vi.mock("react-native-reanimated", () => ({
  useSharedValue: (value: number) => ({ value, get: () => value, set: () => {} }),
  withTiming: (value: number) => value,
}));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  native.phoneLanguages = ["en-US"];
  native.foreground = true;
  native.dictationLanguage = "automatic";
  vi.clearAllMocks();
});

function mount(initial = "") {
  const root = createRoot(document.createElement("div"));
  const state: { draft: string; dictation: VoiceDictation | null } = { draft: initial, dictation: null };
  function Harness({ enabled }: { enabled: boolean }) {
    state.dictation = useVoiceDictation({
      enabled,
      onDraft: (text) => {
        state.draft = text;
      },
    });
    return null;
  }
  const render = (enabled = true) => act(() => root.render(<Harness enabled={enabled} />));
  render();
  cleanups.push(() => act(() => root.unmount()));
  const dictation = () => {
    if (!state.dictation) throw new Error("Hook did not mount");
    return state.dictation;
  };
  return { state, dictation, render };
}

async function listen(harness: ReturnType<typeof mount>) {
  await act(async () => harness.dictation().start(harness.state.draft));
  await vi.waitFor(() => expect(native.module.start).toHaveBeenCalled());
  act(() => native.emit("start"));
}

it("writes live speech after the draft and keeps it when the user finishes", async () => {
  const harness = mount("Please");
  await listen(harness);
  expect(harness.dictation().phase).toBe("listening");

  act(() => native.emit("result", { isFinal: false, results: [{ transcript: "fix" }] }));
  expect(harness.state.draft).toBe("Please fix");
  act(() => native.emit("result", { isFinal: false, results: [{ transcript: "fix the build" }] }));
  expect(harness.state.draft).toBe("Please fix the build");

  let finished = false;
  act(() => {
    void harness
      .dictation()
      .finish()
      .then(() => {
        finished = true;
      });
  });
  expect(native.module.stop).toHaveBeenCalled();
  expect(harness.dictation().phase).toBe("stopping");
  act(() => native.emit("result", { isFinal: true, results: [{ transcript: "fix the build." }] }));
  await act(async () => native.emit("end"));
  expect(finished).toBe(true);
  expect(harness.state.draft).toBe("Please fix the build.");
  expect(harness.dictation().phase).toBe("idle");
});

it("puts back the earlier draft on cancel", async () => {
  const harness = mount("Keep this");
  await listen(harness);
  act(() => native.emit("result", { isFinal: false, results: [{ transcript: "discard this" }] }));
  expect(harness.state.draft).toBe("Keep this discard this");

  act(() => harness.dictation().cancel());
  expect(native.module.abort).toHaveBeenCalled();
  expect(harness.state.draft).toBe("Keep this");
  expect(harness.dictation().phase).toBe("idle");
});

it("asks for on-device recognition on Android only for an installed language", async () => {
  const withoutModel = mount();
  await listen(withoutModel);
  expect(native.module.start).toHaveBeenLastCalledWith(
    expect.objectContaining({ interimResults: true, continuous: true, requiresOnDeviceRecognition: false }),
  );
  await act(async () => native.emit("end"));

  native.module.getSupportedLocales.mockResolvedValueOnce({ locales: ["en-US"], installedLocales: ["en-US"] });
  const withModel = mount();
  await listen(withModel);
  expect(native.module.start).toHaveBeenLastCalledWith(
    expect.objectContaining({ lang: "en-US", requiresOnDeviceRecognition: true }),
  );
});

it("dictates in the phone's language, or in the language chosen in Settings", async () => {
  native.phoneLanguages = ["pl-PL", "en-US"];
  native.module.getSupportedLocales.mockResolvedValueOnce({
    locales: ["en-US", "pl-PL", "de-DE"],
    installedLocales: [],
  });
  const harness = mount();
  await listen(harness);
  expect(native.module.start).toHaveBeenLastCalledWith(expect.objectContaining({ lang: "pl-PL" }));
  await act(async () => native.emit("end"));

  native.dictationLanguage = "de-DE";
  await listen(harness);
  expect(native.module.start).toHaveBeenLastCalledWith(expect.objectContaining({ lang: "de-DE" }));
});

it("tries the system service once when on-device recognition fails before any speech", async () => {
  const locale = "en-US";
  native.module.getSupportedLocales.mockResolvedValueOnce({ locales: [locale], installedLocales: [locale] });
  const harness = mount();
  await listen(harness);

  act(() => native.emit("error", { error: "audio-capture", message: "Failed" }));
  act(() => native.emit("end"));
  expect(native.alert).not.toHaveBeenCalled();
  expect(native.module.start).toHaveBeenCalledTimes(2);
  expect(native.module.start).toHaveBeenLastCalledWith(expect.objectContaining({ requiresOnDeviceRecognition: false }));
  expect(harness.dictation().phase).toBe("listening");

  act(() => native.emit("result", { isFinal: false, results: [{ transcript: "it works" }] }));
  expect(harness.state.draft).toBe("it works");

  // The system service failing too is a real failure.
  act(() => native.emit("error", { error: "network", message: "Offline" }));
  await act(async () => native.emit("end"));
  expect(native.alert).toHaveBeenCalledTimes(1);
  expect(native.module.start).toHaveBeenCalledTimes(2);
  expect(harness.dictation().phase).toBe("idle");
});

it("explains a denied permission and does not listen", async () => {
  native.module.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
  const harness = mount();
  await act(async () => harness.dictation().start(""));

  await vi.waitFor(() => expect(native.alert).toHaveBeenCalled());
  expect(native.alert.mock.calls[0]?.[0]).toBe("Microphone access is off");
  expect(native.module.start).not.toHaveBeenCalled();
  expect(harness.dictation().phase).toBe("idle");
});

it("stops listening and keeps the text when the chat is disabled", async () => {
  const harness = mount();
  await listen(harness);
  act(() => native.emit("result", { isFinal: false, results: [{ transcript: "half a thought" }] }));

  harness.render(false);
  expect(native.module.stop).toHaveBeenCalled();
  await act(async () => native.emit("end"));
  expect(harness.state.draft).toBe("half a thought");
});

it("leaves other chats' drafts alone", async () => {
  const speaking = mount("A");
  const other = mount("B");
  await listen(speaking);
  // The native session is shared, so a second chat cannot start over it.
  await act(async () => other.dictation().start("B"));
  expect(native.module.start).toHaveBeenCalledTimes(1);

  act(() => native.emit("result", { isFinal: false, results: [{ transcript: "hello" }] }));
  expect(speaking.state.draft).toBe("A hello");
  expect(other.state.draft).toBe("B");
});

it("ignores the late end of a cancelled session when the user presses the mic again", async () => {
  const harness = mount();
  await listen(harness);
  act(() => harness.dictation().cancel());

  let grant: (value: { granted: boolean }) => void = () => {};
  native.module.requestPermissionsAsync.mockReturnValueOnce(
    new Promise((resolve) => {
      grant = resolve;
    }),
  );
  act(() => harness.dictation().start(""));
  // abort() reports the first session's end only now.
  act(() => native.emit("end"));
  expect(harness.dictation().phase).toBe("starting");

  await act(async () => grant({ granted: true }));
  await vi.waitFor(() => expect(native.module.start).toHaveBeenCalledTimes(2));
  act(() => native.emit("start"));
  expect(harness.dictation().phase).toBe("listening");
});

it("keeps the first press while Android's permission dialog puts the app in the background", async () => {
  let grant: (value: { granted: boolean }) => void = () => {};
  native.module.requestPermissionsAsync.mockReturnValueOnce(
    new Promise((resolve) => {
      grant = resolve;
    }),
  );
  const harness = mount();
  act(() => harness.dictation().start(""));
  native.foreground = false;
  harness.render();
  native.foreground = true;
  harness.render();

  await act(async () => grant({ granted: true }));
  await vi.waitFor(() => expect(native.module.start).toHaveBeenCalled());
  expect(native.module.abort).not.toHaveBeenCalled();

  // A real trip to the background while listening still stops and keeps the text.
  act(() => native.emit("start"));
  native.foreground = false;
  harness.render();
  expect(native.module.stop).toHaveBeenCalled();
});
