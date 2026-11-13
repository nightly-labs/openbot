import {
  AUTOMATIC_VOICE_LANGUAGE,
  CLOUD_SPEECH_MODELS,
  CODEX_LIVE_VOICES,
  type CodexLiveVoice,
  cloudSpeechModel,
  type DictationKeyProvider,
  ELEVENLABS_SPEECH_VOICES,
  ELEVENLABS_VOICE_MODEL_ID,
  isElevenLabsSpeechVoice,
  isSpeechVoice,
  isVoiceModelId,
  isXaiSpeechVoice,
  modelLanguage,
  SPEECH_MODEL,
  SPEECH_MODEL_ID,
  SPEECH_SPEEDS,
  SPEECH_VOICES,
  type SpeechKeyProvider,
  type SpeechModelId,
  type SpeechSpeed,
  type SpeechVoice,
  VOICE_MODELS,
  type VoiceLanguage,
  type VoiceModelId,
  type VoiceModelInfo,
  WHISPER_LANGUAGES,
  type WhisperLanguage,
  XAI_SPEECH_VOICES,
} from "@openbot/contracts/ipc";
import { shortVoiceServerModel, voiceServerHost } from "@openbot/contracts/voice-server";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Play,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  Square,
  SwitchField,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, Show } from "solid-js";
import type { CodexLiveAccess } from "../speech/codex-live-access";
import type { SettingsVoiceStore } from "./settings-voice-store";
import {
  type ModelChoice,
  type ModelDownload,
  ModelDownloadToasts,
  type ModelFile,
  VoiceKeyRow,
  VoiceModelRow,
} from "./VoiceModelRow";
import { VoiceServerDialog } from "./VoiceServerDialog";

const MODEL_DESCRIPTION = {
  "parakeet-tdt-0.6b-v3": "settings.voice.model.parakeet.description",
  "parakeet-unified-en-0.6b": "settings.voice.model.parakeetUnified.description",
  "bark-3.0-plus": "settings.voice.model.bark.description",
  "whisper-turbo": "settings.voice.model.whisper.description",
  "cohere-transcribe-03-2026": "settings.voice.model.cohere.description",
  [ELEVENLABS_VOICE_MODEL_ID]: "settings.voice.model.elevenlabs.description",
  "groq-whisper-large-v3-turbo": "settings.voice.model.groqTurbo.description",
  "groq-whisper-large-v3": "settings.voice.model.groqLarge.description",
} as const satisfies Record<VoiceModelInfo["id"], AppTextKey>;

const SPEECH_MODEL_DESCRIPTION = {
  [SPEECH_MODEL_ID]: "settings.voice.speech.model.description",
  "elevenlabs-flash-v2.5": "settings.voice.speech.model.flash.description",
  "elevenlabs-multilingual-v2": "settings.voice.speech.model.multilingual.description",
  "elevenlabs-v3": "settings.voice.speech.model.v3.description",
  "elevenlabs-v4-turbo": "settings.voice.speech.model.v4Turbo.description",
  "elevenlabs-v4": "settings.voice.speech.model.v4.description",
  "xai-tts": "settings.voice.speech.model.xai.description",
} as const satisfies Record<SpeechModelId, AppTextKey>;

/** Supertonic first, then the cloud models by provider. */
const SPEECH_CHOICES: readonly ModelChoice<SpeechModelId>[] = [
  { id: SPEECH_MODEL_ID, name: SPEECH_MODEL.name, place: "local" },
  ...CLOUD_SPEECH_MODELS.map((model) => ({ id: model.id, name: model.name, place: model.provider })),
];

/**
 * The voices of each speech model place. The arrays stay the same objects: a new array makes the
 * Select send its value again, and that write starts the same change again.
 */
const VOICE_OPTIONS: Record<"local" | SpeechKeyProvider, string[]> = {
  local: [...SPEECH_VOICES],
  elevenlabs: [...ELEVENLABS_SPEECH_VOICES],
  xai: [...XAI_SPEECH_VOICES],
};

/** The language that the model uses, and why it cannot be set, for each model that takes no language. */
const FIXED_LANGUAGE: Partial<Record<VoiceModelInfo["id"], { language: VoiceLanguage; description: AppTextKey }>> = {
  "parakeet-tdt-0.6b-v3": { language: AUTOMATIC_VOICE_LANGUAGE, description: "settings.voice.language.modelDetects" },
  "parakeet-unified-en-0.6b": { language: "en", description: "settings.voice.language.parakeetUnifiedEnglishOnly" },
  "bark-3.0-plus": { language: "en", description: "settings.voice.language.englishOnly" },
};

/** `jw` is Whisper's code for Javanese, whose catalog name is under `jv`. */
const LANGUAGE_NAME = {
  af: "language.name.af",
  am: "language.name.am",
  ar: "language.name.ar",
  az: "language.name.az",
  be: "language.name.be",
  bg: "language.name.bg",
  bn: "language.name.bn",
  bs: "language.name.bs",
  ca: "language.name.ca",
  cs: "language.name.cs",
  cy: "language.name.cy",
  da: "language.name.da",
  de: "language.name.de",
  el: "language.name.el",
  en: "language.name.en",
  es: "language.name.es",
  et: "language.name.et",
  eu: "language.name.eu",
  fa: "language.name.fa",
  fi: "language.name.fi",
  fr: "language.name.fr",
  gl: "language.name.gl",
  gu: "language.name.gu",
  he: "language.name.he",
  hi: "language.name.hi",
  hr: "language.name.hr",
  hu: "language.name.hu",
  hy: "language.name.hy",
  id: "language.name.id",
  is: "language.name.is",
  it: "language.name.it",
  ja: "language.name.ja",
  jw: "language.name.jv",
  ka: "language.name.ka",
  kk: "language.name.kk",
  km: "language.name.km",
  kn: "language.name.kn",
  ko: "language.name.ko",
  lo: "language.name.lo",
  lt: "language.name.lt",
  lv: "language.name.lv",
  mk: "language.name.mk",
  ml: "language.name.ml",
  mn: "language.name.mn",
  mr: "language.name.mr",
  ms: "language.name.ms",
  mt: "language.name.mt",
  my: "language.name.my",
  ne: "language.name.ne",
  nl: "language.name.nl",
  no: "language.name.no",
  pa: "language.name.pa",
  pl: "language.name.pl",
  pt: "language.name.pt",
  ro: "language.name.ro",
  ru: "language.name.ru",
  si: "language.name.si",
  sk: "language.name.sk",
  sl: "language.name.sl",
  sq: "language.name.sq",
  sr: "language.name.sr",
  su: "language.name.su",
  sv: "language.name.sv",
  sw: "language.name.sw",
  ta: "language.name.ta",
  te: "language.name.te",
  th: "language.name.th",
  tr: "language.name.tr",
  uk: "language.name.uk",
  ur: "language.name.ur",
  uz: "language.name.uz",
  vi: "language.name.vi",
  yue: "language.name.yue",
  zh: "language.name.zh",
} as const satisfies Record<WhisperLanguage, AppTextKey>;

/** The country of a language's flag: the likely region of the language, as `Intl.Locale` gives it. */
function flagFor(language: VoiceLanguage): string {
  if (language === AUTOMATIC_VOICE_LANGUAGE) return "🌐";
  try {
    const region = new Intl.Locale(language === "jw" ? "jv" : language).maximize().region;
    if (region && /^[A-Z]{2}$/u.test(region))
      return String.fromCodePoint(...[...region].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
  } catch {
    // A tag the engine does not know shows no flag.
  }
  return "🌐";
}

/** `automatic` lets OpenAI choose the voice of live voice. */
type LiveVoiceChoice = CodexLiveVoice | "automatic";

interface SettingsVoiceTabProps {
  store: SettingsVoiceStore;
  selectMount: HTMLElement | undefined;
  codexLiveAccess?: CodexLiveAccess | undefined;
  /** Opens the Providers section of this computer, where Codex signs in. */
  onConnectCodex?: (() => void) | undefined;
}

export function SettingsVoiceTab(props: SettingsVoiceTabProps) {
  const { t, format } = useText();
  const settings = () => props.store.state.settings;
  const activeModel = () => VOICE_MODELS.find((model) => model.id === settings()?.modelId);
  /** A retired model shows only while it is in use or has files on this computer. */
  const shownModels = createMemo(() =>
    VOICE_MODELS.filter(
      (model) =>
        model.kind === "cloud" ||
        !model.retired ||
        settings()?.modelId === model.id ||
        (props.store.state.statuses[model.id]?.phase ?? "missing") !== "missing",
    ),
  );
  const server = () => props.store.state.server;
  /** While the user's own server takes dictation, no model on this computer is in use. */
  const serverDictates = () => server()?.routes.dictation === true;
  /** While the user's own server reads replies, Supertonic's voices do not apply. */
  const serverSpeaks = () => server()?.routes.speech === true;
  /** The server gets the language that the user sets, so a local model's fixed language does not apply. */
  const fixedLanguage = () => {
    const model = activeModel();
    return model && !model.supportsLanguage && !serverDictates() ? FIXED_LANGUAGE[model.id] : undefined;
  };
  /**
   * A model with its own languages, such as Cohere Transcribe, offers only those and no automatic.
   * A memo, so that a save keeps the same list and the options do not change under the Select.
   */
  const modelLanguages = createMemo(() => (serverDictates() ? undefined : activeModel()?.languages));
  const shownLanguage = (): VoiceLanguage | null => {
    const fixed = fixedLanguage();
    if (fixed) return fixed.language;
    const model = activeModel();
    const saved = settings()?.language;
    if (!saved) return null;
    return model && !serverDictates() ? modelLanguage(model, saved) : saved;
  };
  const languageDescription = (): AppTextKey =>
    fixedLanguage()?.description ??
    (modelLanguages() ? "settings.voice.language.modelLanguages" : "settings.voice.language.description");
  const languageLocked = () => !settings() || (!serverDictates() && activeModel()?.supportsLanguage === false);
  const languageName = (language: VoiceLanguage) =>
    language === AUTOMATIC_VOICE_LANGUAGE ? t("settings.voice.language.automatic") : t(LANGUAGE_NAME[language]);
  const languageOptions = createMemo((): VoiceLanguage[] => {
    const collator = new Intl.Collator(format.locale);
    const own = modelLanguages();
    const languages = own ?? WHISPER_LANGUAGES;
    const names = new Map(languages.map((language) => [language, languageName(language)]));
    const sorted = [...languages].sort((left, right) =>
      collator.compare(names.get(left) ?? left, names.get(right) ?? right),
    );
    return own ? sorted : [AUTOMATIC_VOICE_LANGUAGE, ...sorted];
  });

  const speech = () => props.store.state.speech;
  const voiceName = (voice: SpeechVoice) =>
    t(voice.startsWith("F") ? "settings.voice.speech.voice.female" : "settings.voice.speech.voice.male", {
      number: voice.slice(1),
    });

  /** The ElevenLabs key is one key for dictation and spoken replies. */
  const elevenLabsKeySaved = () => props.store.state.statuses[ELEVENLABS_VOICE_MODEL_ID]?.phase === "ready";
  /** The provider of the cloud model in use, or undefined for a model on this computer. */
  const cloudProvider = (): DictationKeyProvider | undefined => {
    const model = activeModel();
    return model?.kind === "cloud" ? model.provider : undefined;
  };
  /** A cloud model is ready when the key of its provider is saved. */
  const cloudKeySaved = () => {
    const id = settings()?.modelId;
    return id ? props.store.state.statuses[id]?.phase === "ready" : false;
  };
  /** The ElevenLabs key also reads replies aloud, so it saves through the speech route. */
  const saveCloudKey = (provider: DictationKeyProvider, key: string) =>
    provider === "elevenlabs"
      ? props.store.saveSpeechApiKey(provider, key)
      : props.store.saveDictationApiKey(provider, key);
  const removeCloudKey = (provider: DictationKeyProvider) =>
    void (provider === "elevenlabs"
      ? props.store.removeSpeechApiKey(provider)
      : props.store.removeDictationApiKey(provider));
  const dictationChoices = createMemo((): ModelChoice<VoiceModelId>[] =>
    shownModels().map((model) => ({
      id: model.id,
      name: model.name,
      place: model.kind === "cloud" ? model.provider : "local",
    })),
  );
  const dictationDescription = () => {
    const model = activeModel();
    return model ? t(MODEL_DESCRIPTION[model.id]) : "";
  };
  const dictationNote = () => (serverDictates() ? t("settings.voice.model.serverDictates") : undefined);
  /** While the server takes dictation, Use gives dictation back to the chosen model. */
  const dictationAction = () => {
    const model = activeModel();
    if (!model || !serverDictates()) return undefined;
    return (
      <Button
        variant="outline"
        size="sm"
        type="button"
        aria-label={t("settings.voice.model.useLabel", { name: model.name })}
        onClick={() => props.store.useModel(model.id)}
      >
        {t("settings.voice.model.use")}
      </Button>
    );
  };
  const dictationFile = (): ModelFile | null => {
    const model = activeModel();
    return model?.kind === "local"
      ? { bytes: model.bytes, status: props.store.state.statuses[model.id] ?? null }
      : null;
  };

  const speechModel = () => speech().settings?.modelId;
  const speechCloud = () => {
    const id = speechModel();
    return id ? cloudSpeechModel(id) : undefined;
  };
  /** The status of the chosen model. Main sends the status of the model in the settings. */
  const speechStatus = () => {
    const status = speech().status;
    return status && status.modelId === speechModel() ? status : null;
  };
  const speechNote = () => (serverSpeaks() ? t("settings.voice.speech.serverSpeaks") : undefined);
  const speechReady = () => speechStatus()?.phase === "ready";
  const speechKeySaved = (provider: SpeechKeyProvider) =>
    provider === "elevenlabs" ? elevenLabsKeySaved() : speechStatus()?.phase === "ready";
  const speechFile = (): ModelFile | null =>
    speechModel() === SPEECH_MODEL_ID ? { bytes: SPEECH_MODEL.bytes, status: speechStatus() } : null;
  const speechDescription = (): AppTextKey => {
    const id = speechModel();
    return id ? SPEECH_MODEL_DESCRIPTION[id] : "settings.voice.speech.model.description";
  };

  /** The voices of the chosen model: Supertonic's numbered voices, or the provider's named ones. */
  const voiceOptions = (): string[] => VOICE_OPTIONS[speechCloud()?.provider ?? "local"];
  const chosenVoice = (): string | null => {
    const saved = speech().settings;
    if (!saved) return null;
    const provider = speechCloud()?.provider;
    if (provider === "elevenlabs") return saved.elevenLabsVoice;
    if (provider === "xai") return saved.xaiVoice;
    return saved.voice;
  };
  /** A provider voice shows its own name, which stays the same in each language. */
  const anyVoiceName = (voice: string) =>
    isSpeechVoice(voice) ? voiceName(voice) : voice.charAt(0).toUpperCase() + voice.slice(1);
  const chooseVoice = (voice: string) => {
    if (voice === chosenVoice()) return;
    if (isSpeechVoice(voice)) props.store.setSpeechVoice(voice);
    else if (isElevenLabsSpeechVoice(voice)) props.store.setElevenLabsVoice(voice);
    else if (isXaiSpeechVoice(voice)) props.store.setXaiVoice(voice);
  };

  /** Each model file that downloads, for the download toasts. */
  const downloads = createMemo((): ModelDownload[] => {
    const local: ModelDownload[] = VOICE_MODELS.flatMap((model) => {
      const status = props.store.state.statuses[model.id];
      return model.kind === "local" && status
        ? [{ id: model.id, name: model.name, progress: status.progress ?? 0, ready: status.phase === "ready" }]
        : [];
    });
    const status = speech().status;
    if (status?.modelId === SPEECH_MODEL_ID)
      local.push({
        id: SPEECH_MODEL_ID,
        name: SPEECH_MODEL.name,
        progress: status.progress ?? 0,
        ready: status.phase === "ready",
      });
    return local;
  });
  const running = createMemo(() => {
    const ids = VOICE_MODELS.filter((model) => props.store.state.statuses[model.id]?.phase === "downloading").map(
      (model): string => model.id,
    );
    const status = speech().status;
    if (status?.modelId === SPEECH_MODEL_ID && status.phase === "downloading") ids.push(SPEECH_MODEL_ID);
    return ids;
  });
  const cancelDownload = (id: string) => {
    if (id === SPEECH_MODEL_ID) props.store.cancelSpeech();
    else if (isVoiceModelId(id)) props.store.cancel(id);
  };

  const [editingServer, setEditingServer] = createSignal(false);

  const liveVoice = (): LiveVoiceChoice => speech().settings?.codexLiveVoice ?? "automatic";
  /** The voices' own names, which stay the same in each language. */
  const liveVoiceName = (voice: LiveVoiceChoice) =>
    voice === "automatic" ? t("settings.voice.language.automatic") : voice.charAt(0).toUpperCase() + voice.slice(1);

  const LanguageLabel = (labelProps: { language: VoiceLanguage | undefined }) => (
    <Show when={labelProps.language}>
      {(language) => (
        <>
          <span aria-hidden="true">{flagFor(language())}</span> {languageName(language())}
        </>
      )}
    </Show>
  );

  return (
    <>
      <SettingsSection
        data-settings-row="settings.voice.dictation.section"
        title={t("settings.voice.dictation.section")}
      >
        <ItemGroup class="settings-modal-card">
          <VoiceModelRow<VoiceModelId>
            choices={dictationChoices()}
            value={settings()?.modelId ?? null}
            onChoose={(id) => props.store.useModel(id)}
            description={dictationDescription()}
            note={dictationNote()}
            file={dictationFile()}
            onDownload={() => {
              const id = settings()?.modelId;
              if (id) props.store.download(id);
            }}
            onRemove={() => {
              const id = settings()?.modelId;
              if (id) props.store.remove(id);
            }}
            action={dictationAction()}
            disabled={!settings()}
            mount={props.selectMount}
          />
          <Show when={cloudProvider()} keyed>
            {(provider) => (
              <VoiceKeyRow
                provider={provider}
                saved={cloudKeySaved()}
                onSave={(key) => saveCloudKey(provider, key)}
                onRemove={() => removeCloudKey(provider)}
              />
            )}
          </Show>
          <Item data-settings-row="settings.voice.language.section" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("settings.voice.language.section")}</ItemTitle>
              <ItemDescription>{t(languageDescription())}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select<VoiceLanguage>
                class="settings-modal-select"
                options={languageOptions()}
                value={shownLanguage()}
                onChange={(next) => next && next !== shownLanguage() && props.store.setLanguage(next)}
                disabled={languageLocked()}
                placement="bottom-end"
                itemComponent={(selectProps) => (
                  <SelectItem item={selectProps.item}>
                    <LanguageLabel language={selectProps.item.rawValue} />
                  </SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-label={t("settings.voice.language.section")}>
                  <SelectValue<VoiceLanguage>>
                    {(state) => <LanguageLabel language={state.selectedOption()} />}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.selectMount} />
              </Select>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={t("settings.voice.speech.section")}>
        <ItemGroup class="settings-modal-card">
          <VoiceModelRow<SpeechModelId>
            choices={SPEECH_CHOICES}
            value={speechModel() ?? null}
            onChoose={(id) => props.store.setSpeechModel(id)}
            description={t(speechDescription())}
            note={speechNote()}
            file={speechFile()}
            onDownload={() => props.store.downloadSpeech()}
            onRemove={() => props.store.removeSpeech()}
            disabled={!speech().settings}
            mount={props.selectMount}
          />
          {/* Keyed: a new provider gets an empty key field, so a draft key is not saved for the other provider. */}
          <Show when={speechCloud()?.provider} keyed>
            {(provider) => (
              <VoiceKeyRow
                provider={provider}
                saved={speechKeySaved(provider)}
                onSave={(key) => props.store.saveSpeechApiKey(provider, key)}
                onRemove={() => void props.store.removeSpeechApiKey(provider)}
              />
            )}
          </Show>
          <SwitchField
            data-settings-row="settings.voice.speech.readReplies.title"
            checked={speech().settings?.readReplies ?? false}
            disabled={!speech().settings}
            onChange={(checked) => props.store.setReadReplies(checked)}
            label={t("settings.voice.speech.readReplies.title")}
            description={t("settings.voice.speech.readReplies.description")}
          />
          <Show when={!serverSpeaks()}>
            <Item data-settings-row="settings.voice.speech.voice.title" class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("settings.voice.speech.voice.title")}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={!speechReady()}
                  onClick={() => void props.store.listen(t("settings.voice.speech.sample"))}
                >
                  <Show when={speech().listening} fallback={<Play size={14} aria-hidden="true" />}>
                    <Square size={14} aria-hidden="true" />
                  </Show>
                  {speech().listening ? t("settings.voice.speech.voice.stop") : t("settings.voice.speech.voice.listen")}
                </Button>
                <Select<string>
                  class="settings-modal-select"
                  options={voiceOptions()}
                  value={chosenVoice()}
                  onChange={(next) => next && chooseVoice(next)}
                  disabled={!speech().settings}
                  placement="bottom-end"
                  itemComponent={(selectProps) => (
                    <SelectItem item={selectProps.item}>{anyVoiceName(selectProps.item.rawValue)}</SelectItem>
                  )}
                >
                  <SelectTrigger size="sm" aria-label={t("settings.voice.speech.voice.title")}>
                    <SelectValue<string>>
                      {(state) => {
                        const voice = state.selectedOption();
                        return voice && anyVoiceName(voice);
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent mount={props.selectMount} />
                </Select>
              </ItemActions>
            </Item>
          </Show>
          <Item data-settings-row="settings.voice.speech.speed.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("settings.voice.speech.speed.title")}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Select<SpeechSpeed>
                class="settings-modal-select"
                options={[...SPEECH_SPEEDS]}
                value={props.store.speechSpeed()}
                onChange={(next) => next && props.store.setSpeechSpeed(next)}
                disabled={!speech().settings}
                placement="bottom-end"
                itemComponent={(selectProps) => (
                  <SelectItem item={selectProps.item}>
                    {t("chat.voice.speedValue", { speed: format.number(selectProps.item.rawValue) })}
                  </SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-label={t("settings.voice.speech.speed.title")}>
                  <SelectValue<SpeechSpeed>>
                    {(state) => {
                      const speed = state.selectedOption();
                      return speed && t("chat.voice.speedValue", { speed: format.number(speed) });
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.selectMount} />
              </Select>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={t("settings.voice.live.section")}>
        <ItemGroup class="settings-modal-card">
          <Show
            when={props.codexLiveAccess !== "signIn"}
            fallback={
              <Item data-settings-row="settings.voice.speech.codexLive.title" class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.voice.speech.codexLive.title")}</ItemTitle>
                  <ItemDescription>{t("settings.voice.live.signIn")}</ItemDescription>
                </ItemContent>
                <Show when={props.onConnectCodex}>
                  {(connect) => (
                    <ItemActions>
                      <Button variant="outline" size="sm" type="button" onClick={() => connect()()}>
                        {t("settings.voice.server.connect")}
                      </Button>
                    </ItemActions>
                  )}
                </Show>
              </Item>
            }
          >
            <SwitchField
              data-settings-row="settings.voice.speech.codexLive.title"
              checked={speech().settings?.codexLive ?? false}
              disabled={!speech().settings}
              onChange={(checked) => props.store.setCodexLive(checked)}
              label={t("settings.voice.speech.codexLive.title")}
              description={t("settings.voice.speech.codexLive.description")}
            />
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("settings.voice.speech.voice.title")}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Select<LiveVoiceChoice>
                  class="settings-modal-select"
                  options={["automatic", ...CODEX_LIVE_VOICES]}
                  value={liveVoice()}
                  onChange={(next) => next && props.store.setCodexLiveVoice(next === "automatic" ? null : next)}
                  disabled={!speech().settings?.codexLive}
                  placement="bottom-end"
                  itemComponent={(selectProps) => (
                    <SelectItem item={selectProps.item}>{liveVoiceName(selectProps.item.rawValue)}</SelectItem>
                  )}
                >
                  <SelectTrigger size="sm" aria-label={t("settings.voice.speech.voice.title")}>
                    <SelectValue<LiveVoiceChoice>>
                      {(state) => {
                        const voice = state.selectedOption();
                        return voice && liveVoiceName(voice);
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent mount={props.selectMount} />
                </Select>
              </ItemActions>
            </Item>
          </Show>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection data-settings-row="settings.voice.server.section" title={t("settings.voice.server.section")}>
        <ItemGroup class="settings-modal-card">
          <Show
            when={server()}
            fallback={
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.voice.server.title")}</ItemTitle>
                  <ItemDescription>{t("settings.voice.server.notSetUp")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button variant="outline" size="sm" type="button" onClick={() => setEditingServer(true)}>
                    {t("settings.voice.server.setUp")}
                  </Button>
                </ItemActions>
              </Item>
            }
          >
            {(saved) => (
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{voiceServerHost(saved().address)}</ItemTitle>
                  <Show when={!serverDictates() && !serverSpeaks()}>
                    <ItemDescription>{t("settings.voice.server.notInUse")}</ItemDescription>
                  </Show>
                  <Show when={serverDictates()}>
                    <ItemDescription>
                      {t("settings.voice.server.dictationSummary", {
                        model: shortVoiceServerModel(saved().routes.transcriptionModel),
                      })}
                    </ItemDescription>
                  </Show>
                  <Show when={serverSpeaks()}>
                    <ItemDescription>
                      {t("settings.voice.server.speechSummary", {
                        model: shortVoiceServerModel(saved().routes.speechModel),
                        voice: saved().routes.voice ?? "",
                      })}
                    </ItemDescription>
                  </Show>
                </ItemContent>
                <ItemActions>
                  <Button variant="ghost" size="sm" type="button" onClick={() => setEditingServer(true)}>
                    {t("common.edit")}
                  </Button>
                  <Button variant="ghost" size="sm" type="button" onClick={() => void props.store.saveServer(null)}>
                    {t("common.remove")}
                  </Button>
                </ItemActions>
              </Item>
            )}
          </Show>
        </ItemGroup>
      </SettingsSection>
      <Show when={editingServer()}>
        <VoiceServerDialog
          saved={server()}
          probe={props.store.probeServer}
          onSave={props.store.saveServer}
          onClose={() => setEditingServer(false)}
        />
      </Show>
      <ModelDownloadToasts downloads={downloads()} running={running()} onCancel={cancelDownload} />
    </>
  );
}
