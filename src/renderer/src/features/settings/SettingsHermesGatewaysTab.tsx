import type { HermesGatewaySetup } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertContent,
  AlertDescription,
  Badge,
  Button,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  SwitchField,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createStore, createUniqueId, For, onSettled, Show, untrack } from "solid-js";
import { type HermesGatewayPort, hermesGatewayPort } from "./hermes-gateway-port";

export function SettingsHermesGatewaysTab(props: { api?: HermesGatewayPort; mount?: HTMLElement | undefined }) {
  const { t, errorMessage } = useText();
  const api = props.api ?? hermesGatewayPort();
  const [state, setState] = createStore<{
    rows: HermesGatewaySetup[];
    url: string;
    error: string | null;
    busy: string | null;
    signingIn: string | null;
  }>({ rows: [], url: "", error: null, busy: null, signingIn: null });
  let revision = 0;
  let active = true;
  let pendingSignIn: string | null = null;
  async function run(id: string, operation: () => Promise<HermesGatewaySetup[]>, signIn = false) {
    const current = ++revision;
    if (signIn) pendingSignIn = id;
    setState((state) => {
      state.busy = id;
      state.error = null;
      state.signingIn = signIn ? id : null;
    });
    try {
      const rows = await operation();
      if (active && revision === current)
        setState((state) => {
          state.rows = rows;
        });
    } catch (error) {
      if (active && revision === current)
        setState((state) => {
          state.error = errorMessage(error, t("error.hermesGateway.failed"));
        });
    } finally {
      if (revision === current) {
        pendingSignIn = null;
        if (active)
          setState((state) => {
            state.busy = null;
            state.signingIn = null;
          });
      }
    }
  }
  onSettled(() => {
    void run("load", () => api.list());
    return () => {
      active = false;
      revision += 1;
      if (pendingSignIn) void api.disconnect(pendingSignIn).catch(() => {});
    };
  });
  const check = () => run("probe", () => api.probe({ url: state.url }));
  return (
    <SettingsSection
      class="hermes-gateways-tab"
      title={t("settings.hermesGateways.title")}
      data-settings-row="settings.hermesGateways.title"
    >
      <ItemGroup class="settings-modal-card">
        <Item>
          <ItemContent>
            <ItemDescription>{t("settings.hermesGateways.limitations")}</ItemDescription>
            <Label for="hermes-gateway-address">{t("settings.hermesGateways.address")}</Label>
            <Input
              id="hermes-gateway-address"
              type="url"
              value={state.url}
              disabled={state.busy !== null}
              onValueChange={(value) =>
                setState((state) => {
                  state.url = value;
                })
              }
              aria-describedby="hermes-gateway-address-hint"
            />
            <ItemDescription id="hermes-gateway-address-hint">
              {t("settings.hermesGateways.addressHint")}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button type="button" variant="outline" disabled={!state.url || state.busy !== null} onClick={check}>
              {state.busy === "probe" ? t("settings.hermesGateways.checking") : t("settings.hermesGateways.check")}
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
      <Show when={state.error}>
        {(error) => (
          <Alert tone="danger" role="alert" report={{ operation: "settings", source: "action", cause_code: "unknown" }}>
            <AlertContent>
              <AlertDescription>{error()}</AlertDescription>
            </AlertContent>
          </Alert>
        )}
      </Show>
      <Show when={state.rows.length === 0 && state.busy === null}>
        <p>{t("settings.hermesGateways.empty")}</p>
      </Show>
      <For each={state.rows}>
        {(entry) => (
          <GatewayCard
            entry={entry}
            mount={props.mount}
            busy={state.busy !== null}
            signingIn={state.signingIn === entry.id}
            onSignIn={(providerId) => run(entry.id, () => api.signIn({ id: entry.id, providerId }), true)}
            onCheck={() => run(entry.id, () => api.probe({ url: entry.url, id: entry.id }))}
            onSelect={(profileId, remember) =>
              run(entry.id, () => api.selectProfile({ id: entry.id, profileId, remember }))
            }
            onDisconnect={() => run(entry.id, () => api.disconnect(entry.id))}
            onForget={() => run(entry.id, () => api.forget(entry.id))}
          />
        )}
      </For>
    </SettingsSection>
  );
}

function GatewayCard(props: {
  entry: HermesGatewaySetup;
  mount?: HTMLElement | undefined;
  busy: boolean;
  signingIn: boolean;
  onSignIn: (provider: string) => void;
  onCheck: () => void;
  onSelect: (profile: string, remember: boolean) => void;
  onDisconnect: () => void;
  onForget: () => void;
}) {
  const { t } = useText();
  const [draft, setDraft] = createStore(
    untrack(() => ({
      provider: props.entry.providers.find((provider) => provider.supported)?.id ?? "",
      profile: props.entry.selectedProfileId ?? "",
      remember: props.entry.remembered,
    })),
  );
  const signingIn = () => props.signingIn || props.entry.phase === "signing-in";
  const status = () =>
    signingIn()
      ? t("settings.hermesGateways.signingIn")
      : props.entry.phase === "connected"
        ? t("settings.hermesGateways.connected")
        : props.entry.phase === "discovered"
          ? t("settings.hermesGateways.discovered")
          : t("settings.hermesGateways.signedOut");
  return (
    <ItemGroup class="settings-modal-card">
      <Item>
        <ItemContent>
          <ItemTitle>{props.entry.url}</ItemTitle>
          <ItemDescription role="status">{status()}</ItemDescription>
          <Badge variant="outline">
            {props.entry.remembered
              ? t("settings.hermesGateways.remembered")
              : t("settings.hermesGateways.sessionOnly")}
          </Badge>
        </ItemContent>
        <ItemActions>
          <Show when={signingIn() || props.entry.phase === "connected"}>
            <Button variant="outline" type="button" onClick={() => props.onDisconnect()}>
              {signingIn() ? t("common.cancel") : t("settings.hermesGateways.disconnect")}
            </Button>
          </Show>
          <Button variant="ghost" type="button" disabled={props.busy} onClick={() => props.onForget()}>
            {t("settings.hermesGateways.forget")}
          </Button>
        </ItemActions>
      </Item>
      <Show when={props.entry.phase !== "connected" && !signingIn()}>
        <Item>
          <ItemContent>
            <Show
              when={props.entry.providers.length > 0}
              fallback={
                <Button type="button" variant="outline" disabled={props.busy} onClick={() => props.onCheck()}>
                  {t("settings.hermesGateways.check")}
                </Button>
              }
            >
              <GatewaySelect
                label={t("settings.hermesGateways.provider")}
                value={draft.provider}
                mount={props.mount}
                options={props.entry.providers
                  .filter((provider) => provider.supported)
                  .map((provider) => ({ id: provider.id, name: provider.name }))}
                disabled={props.busy}
                onChange={(value) =>
                  setDraft((state) => {
                    state.provider = value;
                  })
                }
              />
              <For each={props.entry.providers.filter((provider) => !provider.supported)}>
                {(provider) => (
                  <ItemDescription>
                    {provider.name}: {t("settings.hermesGateways.unsupportedProvider")}
                  </ItemDescription>
                )}
              </For>
              <Show when={!props.entry.providers.some((provider) => provider.supported)}>
                <ItemDescription>{t("settings.hermesGateways.unsupported")}</ItemDescription>
              </Show>
            </Show>
          </ItemContent>
          <ItemActions>
            <Button
              type="button"
              disabled={props.busy || !draft.provider}
              onClick={() => props.onSignIn(draft.provider)}
            >
              {t("settings.hermesGateways.signIn")}
            </Button>
          </ItemActions>
        </Item>
      </Show>
      <Show when={props.entry.phase === "connected"}>
        <Item>
          <ItemContent>
            <Show
              when={props.entry.profiles.length > 0}
              fallback={<ItemDescription>{t("settings.hermesGateways.noProfiles")}</ItemDescription>}
            >
              <GatewaySelect
                label={t("settings.hermesGateways.profile")}
                options={props.entry.profiles}
                value={draft.profile}
                mount={props.mount}
                disabled={props.busy}
                onChange={(value) =>
                  setDraft((state) => {
                    state.profile = value;
                  })
                }
              />
              <SwitchField
                checked={draft.remember}
                disabled={props.busy}
                label={t("settings.hermesGateways.remember")}
                description={t("settings.hermesGateways.rememberHint")}
                onChange={(value) =>
                  setDraft((state) => {
                    state.remember = value;
                  })
                }
              />
            </Show>
            <Show when={props.entry.selectedProfileId}>
              {(profile) => (
                <>
                  <ItemDescription>{t("settings.hermesGateways.selected", { profile: profile() })}</ItemDescription>
                  <ItemDescription role="status">{t("settings.hermesGateways.selectedNotice")}</ItemDescription>
                </>
              )}
            </Show>
          </ItemContent>
          <ItemActions>
            <Button
              type="button"
              disabled={props.busy || !props.entry.profiles.some((profile) => profile.id === draft.profile)}
              onClick={() => props.onSelect(draft.profile, draft.remember)}
            >
              {t("settings.hermesGateways.select")}
            </Button>
          </ItemActions>
        </Item>
      </Show>
    </ItemGroup>
  );
}

function GatewaySelect(props: {
  label: string;
  options: { id: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  mount?: HTMLElement | undefined;
}) {
  const labelId = createUniqueId();
  const selectId = `hermes-${labelId}`;
  return (
    <>
      <Label id={labelId} for={selectId}>
        {props.label}
      </Label>
      <Select<string>
        placeholder={props.label}
        options={props.options.map((option) => option.id)}
        value={props.value || null}
        disabled={props.disabled}
        onChange={(value) => value && props.onChange(value)}
        itemComponent={(item) => (
          <SelectItem item={item.item}>
            {props.options.find((option) => option.id === item.item.rawValue)?.name}
          </SelectItem>
        )}
      >
        <SelectTrigger id={selectId} aria-labelledby={labelId}>
          <SelectValue<string>>
            {(state) => props.options.find((option) => option.id === state.selectedOption())?.name ?? props.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent mount={props.mount} />
      </Select>
    </>
  );
}
