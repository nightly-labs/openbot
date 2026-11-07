import {
  sameCustomProviderOrigin,
  VOICE_SERVER_LIMITS,
  type VoiceServerConnection,
  type VoiceServerInput,
  type VoiceServerModels,
  type VoiceServerProbe,
  type VoiceServerProbeField,
  type VoiceServerRoutes,
  type VoiceServerSettings,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  Dialog,
  Field,
  Heading,
  IconButton,
  Input,
  ItemGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Server,
  Switch,
  Text,
  X,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, createStore, For, onSettled, Show, untrack } from "solid-js";

const NO_ROUTES: VoiceServerRoutes = {
  dictation: false,
  speech: false,
  transcriptionModel: null,
  speechModel: null,
  voice: null,
};

/** The example in the empty address field: a Speaches server on the local network. */
const ADDRESS_EXAMPLE = "http://studio.local:8000/v1";

/** The last part of a model ID, which is the part that a person reads. */
export function shortModel(model: string | null): string {
  if (!model) return "";
  return model.split("/").pop() || model;
}

/** `studio.local:8000` for `http://studio.local:8000/v1`: the destination that the user knows. */
export function voiceServerHost(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

/** The key goes into an HTTP header, so main refuses other characters. Checked here to put the error on the key. */
function keyProblem(apiKey: string): AppTextKey | undefined {
  if (apiKey.length > VOICE_SERVER_LIMITS.apiKey) return "error.provider.apiKeyTooLong";
  if (apiKey && !/^[\x21-\x7e]+$/u.test(apiKey)) return "error.provider.keyInvalidCharacters";
  return undefined;
}

/**
 * Makes the routes agree with what a test found. A route that the server does not have turns off; a
 * route that had no model yet turns on, so a new server is in use when its setup is done.
 */
function fitRoutes(routes: VoiceServerRoutes, models: VoiceServerModels): void {
  const known = (list: readonly string[], value: string | null) => (value && list.includes(value) ? value : null);
  if (!routes.transcriptionModel && models.transcription.length > 0) routes.dictation = true;
  if (!routes.speechModel && models.speech.length > 0) routes.speech = true;
  routes.transcriptionModel = known(models.transcription, routes.transcriptionModel) ?? models.transcription[0] ?? null;
  routes.speechModel = known(models.speech, routes.speechModel) ?? models.speech[0] ?? null;
  routes.voice = known(models.voices, routes.voice) ?? models.voices[0] ?? null;
  if (!routes.transcriptionModel) routes.dictation = false;
  if (!routes.speechModel || !routes.voice) routes.speech = false;
}

type TestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found" }
  | { status: "failed"; field: VoiceServerProbeField; message: string };

/**
 * The dialog's draft. `known` is what the last good test found: it stays after an edit of the
 * address or the key, so the routes stay in place, disabled, until the next test.
 */
function createServerForm(
  saved: VoiceServerSettings | null,
  probe: (connection: VoiceServerConnection) => Promise<VoiceServerProbe>,
) {
  const { t, errorMessage } = useText();
  const [form, setForm] = createStore<{
    address: string;
    apiKey: string;
    routes: VoiceServerRoutes;
    test: TestState;
    known: VoiceServerModels | null;
    saving: boolean;
  }>({
    address: saved?.address ?? "",
    apiKey: "",
    routes: { ...(saved?.routes ?? NO_ROUTES) },
    test: { status: "idle" },
    known: null,
    saving: false,
  });
  let run = 0;
  const fail = (field: VoiceServerProbeField, message: string) =>
    setForm((draft) => {
      draft.test = { status: "failed", field, message };
    });
  const connect = async () => {
    const current = ++run;
    const apiKey = form.apiKey.trim();
    const problem = keyProblem(apiKey);
    if (problem) return fail("apiKey", t(problem));
    setForm((draft) => {
      draft.test = { status: "loading" };
    });
    // An empty key keeps the saved one, when the server is the same.
    const result = await probe({ address: form.address.trim(), apiKey: apiKey || null }).catch(
      (error: unknown): VoiceServerProbe => ({
        ok: false,
        field: "address",
        message: errorMessage(error, t("settings.voice.server.probeFailed")),
      }),
    );
    if (current !== run) return;
    if (!result.ok) return fail(result.field, errorMessage(result.message, t("settings.voice.server.probeFailed")));
    setForm((draft) => {
      draft.test = { status: "found" };
      draft.known = {
        transcription: [...result.models.transcription],
        speech: [...result.models.speech],
        voices: [...result.models.voices],
      };
      fitRoutes(draft.routes, result.models);
    });
  };
  return {
    form,
    connected: () => form.test.status === "found",
    testing: () => form.test.status === "loading",
    /** The message of a failed test, on the field that caused it. */
    error: (field: VoiceServerProbeField) =>
      form.test.status === "failed" && form.test.field === field ? form.test.message : undefined,
    /** A change to the address or the key makes the last test out of date. */
    edit: (patch: { address?: string; apiKey?: string }) => {
      run += 1;
      setForm((draft) => {
        Object.assign(draft, patch);
        draft.test = { status: "idle" };
      });
    },
    connect,
    setRoutes: (change: (routes: VoiceServerRoutes) => void) => setForm((draft) => change(draft.routes)),
    setSaving: (saving: boolean) =>
      setForm((draft) => {
        draft.saving = saving;
      }),
    input: (): VoiceServerInput => ({
      address: form.address.trim(),
      apiKey: form.apiKey.trim() || null,
      routes: { ...form.routes },
    }),
  };
}

/** A select list of plain strings, with the same trigger as the rest of the Voice tab. */
function OptionSelect(props: {
  label: string;
  options: readonly string[];
  value: string | null;
  onChange: (value: string) => void;
  mount: HTMLElement | undefined;
  disabled: boolean;
  format: (value: string) => string;
}) {
  return (
    <Select<string>
      class="settings-modal-select"
      options={[...props.options]}
      value={props.value}
      onChange={(next) => next && props.onChange(next)}
      disabled={props.disabled}
      placement="bottom-start"
      itemComponent={(selectProps) => (
        <SelectItem item={selectProps.item}>{props.format(selectProps.item.rawValue)}</SelectItem>
      )}
    >
      <SelectTrigger size="sm" aria-label={props.label}>
        <SelectValue<string>>
          {(state) => {
            const selected = state.selectedOption();
            return selected && props.format(selected);
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}

const ROUTES = [
  {
    capability: "transcription",
    label: "settings.voice.server.route.dictation",
    modelLabel: "settings.voice.server.route.dictationModel",
  },
  {
    capability: "speech",
    label: "settings.voice.server.route.speech",
    modelLabel: "settings.voice.server.route.speechModel",
  },
] as const satisfies readonly { capability: "transcription" | "speech"; label: AppTextKey; modelLabel: AppTextKey }[];

interface RoutesProps {
  models: VoiceServerModels;
  routes: VoiceServerRoutes;
  /** The address or the key changed after the last test: the routes wait for the next one. */
  disabled: boolean;
  mount: HTMLElement | undefined;
  setRoutes: (change: (routes: VoiceServerRoutes) => void) => void;
}

/** One line for each route: the name, its select lists, and a switch at the end. */
function RouteLines(props: RoutesProps) {
  const { t } = useText();
  const keep = (value: string) => value;
  return (
    <ItemGroup class="settings-modal-card">
      <For each={ROUTES}>
        {(entry) => {
          const speech = entry.capability === "speech";
          const models = () => (speech ? props.models.speech : props.models.transcription);
          const available = () => models().length > 0;
          const on = () => available() && (speech ? props.routes.speech : props.routes.dictation);
          const model = () => (speech ? props.routes.speechModel : props.routes.transcriptionModel);
          const modelClass = () => (speech ? "voice-server-model" : "voice-server-model voice-server-wide");
          const locked = () => props.disabled || !available();
          const setOn = (next: boolean) =>
            props.setRoutes((routes) => {
              if (speech) routes.speech = next;
              else routes.dictation = next;
            });
          const setModel = (next: string) =>
            props.setRoutes((routes) => {
              if (speech) routes.speechModel = next;
              else routes.transcriptionModel = next;
            });
          return (
            <div class="voice-server-line">
              <div class="voice-server-name">
                <Text variant="label">{t(entry.label)}</Text>
                <Show when={!available()}>
                  <Text variant="caption" tone="secondary">
                    {t("settings.voice.server.route.missing")}
                  </Text>
                </Show>
              </div>
              <Show when={on()}>
                <div class={modelClass()}>
                  <OptionSelect
                    label={t(entry.modelLabel)}
                    options={models()}
                    value={model()}
                    disabled={props.disabled}
                    mount={props.mount}
                    format={shortModel}
                    onChange={setModel}
                  />
                </div>
                <Show when={speech}>
                  <div class="voice-server-voice">
                    <OptionSelect
                      label={t("settings.voice.server.route.voice")}
                      options={props.models.voices}
                      value={props.routes.voice}
                      disabled={props.disabled}
                      mount={props.mount}
                      format={keep}
                      onChange={(next) =>
                        props.setRoutes((routes) => {
                          routes.voice = next;
                        })
                      }
                    />
                  </div>
                </Show>
              </Show>
              <div class="voice-server-end">
                <Switch aria-label={t(entry.label)} checked={on()} disabled={locked()} onChange={setOn} />
              </div>
            </div>
          );
        }}
      </For>
    </ItemGroup>
  );
}

export interface VoiceServerDialogProps {
  /** The saved server, or null to set up a new one. */
  saved: VoiceServerSettings | null;
  probe: (connection: VoiceServerConnection) => Promise<VoiceServerProbe>;
  /** Resolves true when main saved the server. */
  onSave: (input: VoiceServerInput) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Address and key, then what to use the server for. One button connects first and saves after: an
 * error goes under the field that caused it, and the routes come in when the server answers.
 */
export function VoiceServerDialog(props: VoiceServerDialogProps) {
  const { t } = useText();
  const saved = untrack(() => props.saved);
  const server = createServerForm(saved, (connection) => props.probe(connection));
  const [mount, setMount] = createSignal<HTMLElement | undefined>(undefined);
  const title = t(saved ? "settings.voice.server.dialog.editTitle" : "settings.voice.server.dialog.setUpTitle");
  const action = () => t(server.connected() ? "common.save" : "settings.voice.server.connect");
  // Main sends the saved key only to the saved origin, so another address shows no saved key.
  const keySaved = () => saved?.hasApiKey === true && sameCustomProviderOrigin(saved.address, server.form.address);
  const keyPlaceholder = () => (keySaved() ? t("settings.voice.server.apiKeySaved") : undefined);
  const busy = () => server.testing() || server.form.saving;
  const ariaBusy = () => (busy() ? "true" : undefined);
  const routesLocked = () => !server.connected() || server.form.saving;
  const submitDisabled = () => !server.form.address.trim() || server.form.saving;
  const submit = async () => {
    if (busy()) return;
    if (!server.connected()) return void server.connect();
    server.setSaving(true);
    const done = await props.onSave(server.input());
    server.setSaving(false);
    if (done) props.onClose();
  };
  // A saved server is tested again at once, so its routes come in with what it has now.
  onSettled(() => {
    if (saved) void server.connect();
  });

  return (
    <Dialog.Root open onOpenChange={(next) => !next && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay class="custom-provider-backdrop">
          <Dialog.Content as="section" class="custom-provider-dialog voice-server-dialog" aria-busy={ariaBusy()}>
            <Dialog.Title class="sr-only">{title}</Dialog.Title>
            <header class="custom-provider-header">
              <span class="custom-provider-mark" aria-hidden="true">
                <Server />
              </span>
              <div class="custom-provider-title">
                <Heading as="h2" size="md">
                  {title}
                </Heading>
                <Text tone="secondary" variant="caption">
                  {t("settings.voice.server.dialog.subtitle")}
                </Text>
              </div>
              <IconButton
                class="custom-provider-close"
                label={t("common.close")}
                variant="ghost"
                onClick={props.onClose}
              >
                <X />
              </IconButton>
            </header>
            <form
              class="custom-provider-body"
              ref={setMount}
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div class="custom-provider-form">
                <Field label={t("settings.voice.server.address")} error={server.error("address")}>
                  <Input
                    value={server.form.address}
                    onValueChange={(address) => server.edit({ address })}
                    placeholder={ADDRESS_EXAMPLE}
                    inputmode="url"
                    autocomplete="off"
                    spellcheck={false}
                  />
                </Field>
                <Field label={t("settings.voice.server.apiKey")} error={server.error("apiKey")}>
                  <Input
                    type="password"
                    value={server.form.apiKey}
                    onValueChange={(apiKey) => server.edit({ apiKey })}
                    placeholder={keyPlaceholder()}
                    autocomplete="off"
                    spellcheck={false}
                  />
                </Field>
                <Show when={server.form.known}>
                  {(models) => (
                    <section class="custom-provider-rows" aria-label={t("settings.voice.server.useFor")}>
                      <div class="custom-provider-rows-heading">
                        <Text variant="label-sm">{t("settings.voice.server.useFor")}</Text>
                      </div>
                      <RouteLines
                        models={models()}
                        routes={server.form.routes}
                        disabled={routesLocked()}
                        mount={mount()}
                        setRoutes={server.setRoutes}
                      />
                    </section>
                  )}
                </Show>
              </div>
              <footer class="custom-provider-actions">
                <Button
                  type="submit"
                  variant="default"
                  disabled={submitDisabled()}
                  loading={server.testing()}
                  loadingLabel={t("settings.voice.server.connecting")}
                >
                  {action()}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
