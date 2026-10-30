import {
  AUTOMATIC_VOICE_LANGUAGE,
  ELEVENLABS_VOICE_MODEL_ID,
  SPEECH_MODEL,
  SPEECH_VOICES,
  type SpeechModelStatus,
  type SpeechVoice,
  VOICE_MODELS,
  type VoiceLanguage,
  type VoiceModelInfo,
  type VoiceModelStatus,
  WHISPER_LANGUAGES,
  type WhisperLanguage,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Badge,
  Button,
  Download,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Play,
  Progress,
  RefreshCw,
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
import { createMemo, createSignal, createStore, For, Show } from "solid-js";
import type { SettingsVoiceStore } from "./settings-voice-store";
import { shortModel, VoiceServerDialog, voiceServerHost } from "./VoiceServerDialog";

const MODEL_DESCRIPTION = {
  "parakeet-tdt-0.6b-v3": "settings.voice.model.parakeet.description",
  "bark-3.0-plus": "settings.voice.model.bark.description",
  "whisper-turbo": "settings.voice.model.whisper.description",
  [ELEVENLABS_VOICE_MODEL_ID]: "settings.voice.model.elevenlabs.description",
} as const satisfies Record<VoiceModelInfo["id"], AppTextKey>;

/** The language that the model uses, and why it cannot be set, for each model that takes no language. */
const FIXED_LANGUAGE: Partial<Record<VoiceModelInfo["id"], { language: VoiceLanguage; description: AppTextKey }>> = {
  "parakeet-tdt-0.6b-v3": { language: AUTOMATIC_VOICE_LANGUAGE, description: "settings.voice.language.modelDetects" },
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

interface SettingsVoiceTabProps {
  store: SettingsVoiceStore;
  selectMount: HTMLElement | undefined;
}

export function SettingsVoiceTab(props: SettingsVoiceTabProps) {
  const { t, format, errorMessage } = useText();
  const settings = () => props.store.state.settings;
  const activeModel = () => VOICE_MODELS.find((model) => model.id === settings()?.modelId);
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
  const languageLocked = () => !settings() || (!serverDictates() && activeModel()?.supportsLanguage === false);
  const languageName = (language: VoiceLanguage) =>
    language === AUTOMATIC_VOICE_LANGUAGE ? t("settings.voice.language.automatic") : t(LANGUAGE_NAME[language]);
  const languageOptions = createMemo((): VoiceLanguage[] => {
    const collator = new Intl.Collator(format.locale);
    const names = new Map(WHISPER_LANGUAGES.map((language) => [language, languageName(language)]));
    const sorted = [...WHISPER_LANGUAGES].sort((left, right) =>
      collator.compare(names.get(left) ?? left, names.get(right) ?? right),
    );
    return [AUTOMATIC_VOICE_LANGUAGE, ...sorted];
  });

  // The key is never read back: main has no getter for it, and the field clears once it is saved.
  const [apiKey, setApiKey] = createStore({ draft: "", saving: false });
  const saveApiKey = async () => {
    const key = apiKey.draft.trim();
    if (!key || apiKey.saving) return;
    setApiKey((draft) => {
      draft.saving = true;
    });
    const saved = await props.store.saveApiKey(key);
    setApiKey((draft) => {
      draft.saving = false;
      if (saved) draft.draft = "";
    });
  };

  const downloadText = (bytes: number, status: VoiceModelStatus | SpeechModelStatus | null) => {
    if (status?.phase === "downloading")
      return t("settings.voice.model.downloading", {
        received: format.fileSize(Math.round((bytes * (status.progress ?? 0)) / 100)),
        total: format.fileSize(bytes),
      });
    if (status?.phase === "error") return errorMessage(status.message, t("settings.voice.model.failed"));
    return t("settings.voice.model.size", { size: format.fileSize(bytes) });
  };
  const statusText = (model: VoiceModelInfo, status: VoiceModelStatus | null) => {
    if (model.kind === "cloud")
      return status?.phase === "ready" ? t("settings.voice.model.keySaved") : t("settings.voice.model.keyMissing");
    return downloadText(model.bytes, status);
  };

  const [editingServer, setEditingServer] = createSignal(false);

  const speech = () => props.store.state.speech;
  const speechPhase = () => speech().status?.phase;
  const voiceName = (voice: SpeechVoice) =>
    t(voice.startsWith("F") ? "settings.voice.speech.voice.female" : "settings.voice.speech.voice.male", {
      number: voice.slice(1),
    });

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
      <SettingsSection data-settings-row="settings.voice.models.title" title={t("settings.voice.models.title")}>
        <ItemGroup class="settings-modal-card">
          <For each={VOICE_MODELS}>
            {(model) => {
              const status = () => props.store.state.statuses[model.id];
              const phase = () => status()?.phase;
              const inUse = () => settings()?.modelId === model.id && !serverDictates();
              return (
                <Item class="settings-modal-row">
                  <ItemContent>
                    <ItemTitle>{model.name}</ItemTitle>
                    <ItemDescription>{t(MODEL_DESCRIPTION[model.id])}</ItemDescription>
                    <ItemDescription aria-live="polite">{statusText(model, status())}</ItemDescription>
                    <Show when={phase() === "downloading"}>
                      <Progress
                        value={status()?.progress ?? 0}
                        aria-label={t("settings.voice.model.progressLabel", { name: model.name })}
                      />
                    </Show>
                    <Show when={model.kind === "cloud" && phase() === "missing"}>
                      <div class="settings-voice-key">
                        <Input
                          type="password"
                          size="sm"
                          autocomplete="off"
                          spellcheck={false}
                          aria-label={t("settings.voice.apiKey.label")}
                          placeholder={t("settings.voice.apiKey.placeholder")}
                          value={apiKey.draft}
                          disabled={apiKey.saving}
                          onValueChange={(value) =>
                            setApiKey((draft) => {
                              draft.draft = value;
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveApiKey();
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          disabled={!apiKey.draft.trim() || apiKey.saving}
                          onClick={() => void saveApiKey()}
                        >
                          {t("settings.voice.apiKey.save")}
                        </Button>
                      </div>
                    </Show>
                  </ItemContent>
                  <ItemActions>
                    {/* The selected model is in use before its download too: dictation downloads it. */}
                    <Show when={inUse()}>
                      <Badge variant="secondary">{t("settings.voice.model.inUse")}</Badge>
                    </Show>
                    <Show when={model.kind === "cloud" && phase() === "ready"}>
                      <Button variant="ghost" size="sm" type="button" onClick={() => void props.store.removeApiKey()}>
                        {t("settings.voice.apiKey.remove")}
                      </Button>
                    </Show>
                    <Show when={model.kind === "local" && phase() === "missing"}>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.downloadLabel", { name: model.name })}
                        onClick={() => props.store.download(model.id)}
                      >
                        <Download size={14} aria-hidden="true" />
                        {t("common.download")}
                      </Button>
                    </Show>
                    <Show when={phase() === "downloading"}>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.cancelLabel", { name: model.name })}
                        onClick={() => props.store.cancel(model.id)}
                      >
                        {t("common.cancel")}
                      </Button>
                    </Show>
                    <Show when={phase() === "error"}>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.retryLabel", { name: model.name })}
                        onClick={() => props.store.download(model.id)}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                        {t("common.tryAgain")}
                      </Button>
                    </Show>
                    <Show when={phase() === "ready" && settings() && !inUse()}>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.useLabel", { name: model.name })}
                        onClick={() => props.store.useModel(model.id)}
                      >
                        {t("settings.voice.model.use")}
                      </Button>
                    </Show>
                    <Show when={model.kind === "local" && phase() === "ready"}>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.removeLabel", { name: model.name })}
                        onClick={() => props.store.remove(model.id)}
                      >
                        {t("common.remove")}
                      </Button>
                    </Show>
                  </ItemActions>
                </Item>
              );
            }}
          </For>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={t("settings.voice.language.section")}>
        <ItemGroup class="settings-modal-card">
          <Item data-settings-row="settings.voice.language.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("settings.voice.language.title")}</ItemTitle>
              <ItemDescription>
                {t(fixedLanguage()?.description ?? "settings.voice.language.description")}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select<VoiceLanguage>
                class="settings-modal-select"
                options={languageOptions()}
                value={fixedLanguage()?.language ?? settings()?.language ?? null}
                onChange={(next) => next && props.store.setLanguage(next)}
                disabled={languageLocked()}
                placement="bottom-end"
                itemComponent={(selectProps) => (
                  <SelectItem item={selectProps.item}>
                    <LanguageLabel language={selectProps.item.rawValue} />
                  </SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-label={t("settings.voice.language.title")}>
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
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{SPEECH_MODEL.name}</ItemTitle>
              <ItemDescription>{t("settings.voice.speech.model.description")}</ItemDescription>
              <ItemDescription aria-live="polite">{downloadText(SPEECH_MODEL.bytes, speech().status)}</ItemDescription>
              <Show when={speechPhase() === "downloading"}>
                <Progress
                  value={speech().status?.progress ?? 0}
                  aria-label={t("settings.voice.model.progressLabel", { name: SPEECH_MODEL.name })}
                />
              </Show>
            </ItemContent>
            <ItemActions>
              <Show when={speechPhase() === "missing"}>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  aria-label={t("settings.voice.model.downloadLabel", { name: SPEECH_MODEL.name })}
                  onClick={() => props.store.downloadSpeech()}
                >
                  <Download size={14} aria-hidden="true" />
                  {t("common.download")}
                </Button>
              </Show>
              <Show when={speechPhase() === "downloading"}>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label={t("settings.voice.model.cancelLabel", { name: SPEECH_MODEL.name })}
                  onClick={() => props.store.cancelSpeech()}
                >
                  {t("common.cancel")}
                </Button>
              </Show>
              <Show when={speechPhase() === "error"}>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  aria-label={t("settings.voice.model.retryLabel", { name: SPEECH_MODEL.name })}
                  onClick={() => props.store.downloadSpeech()}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  {t("common.tryAgain")}
                </Button>
              </Show>
              <Show when={speechPhase() === "ready"}>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label={t("settings.voice.model.removeLabel", { name: SPEECH_MODEL.name })}
                  onClick={() => props.store.removeSpeech()}
                >
                  {t("common.remove")}
                </Button>
              </Show>
            </ItemActions>
          </Item>
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
                  disabled={speechPhase() !== "ready"}
                  onClick={() => void props.store.listen(t("settings.voice.speech.sample"))}
                >
                  <Show when={speech().listening} fallback={<Play size={14} aria-hidden="true" />}>
                    <Square size={14} aria-hidden="true" />
                  </Show>
                  {speech().listening ? t("settings.voice.speech.voice.stop") : t("settings.voice.speech.voice.listen")}
                </Button>
                <Select<SpeechVoice>
                  class="settings-modal-select"
                  options={[...SPEECH_VOICES]}
                  value={speech().settings?.voice ?? null}
                  onChange={(next) => next && props.store.setSpeechVoice(next)}
                  disabled={!speech().settings}
                  placement="bottom-end"
                  itemComponent={(selectProps) => (
                    <SelectItem item={selectProps.item}>{voiceName(selectProps.item.rawValue)}</SelectItem>
                  )}
                >
                  <SelectTrigger size="sm" aria-label={t("settings.voice.speech.voice.title")}>
                    <SelectValue<SpeechVoice>>
                      {(state) => {
                        const voice = state.selectedOption();
                        return voice && voiceName(voice);
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
                        model: shortModel(saved().routes.transcriptionModel),
                      })}
                    </ItemDescription>
                  </Show>
                  <Show when={serverSpeaks()}>
                    <ItemDescription>
                      {t("settings.voice.server.speechSummary", {
                        model: shortModel(saved().routes.speechModel),
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
    </>
  );
}
