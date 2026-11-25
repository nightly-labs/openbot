import type {
  NearAgentsInput,
  NearDepositAddress,
  NearPasskeyBackup,
  NearWalletCreateInput,
  NearWalletStatus,
} from "@openbot/contracts/ipc";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertTitle,
  Button,
  Check,
  Checkbox,
  Dialog,
  IconButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  KeyRound,
  Search,
  ShieldCheck,
  Spinner,
  Switch,
  Text,
  TriangleAlert,
  X,
} from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import type { JSX } from "@solidjs/web";
import { Switch as Choose, createSignal, createStore, createUniqueId, For, Match, onCleanup, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { type TextValue, useText } from "../../text";

export type NearWalletAgent = Pick<
  AgentProfile,
  "id" | "name" | "title" | "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl"
>;

export interface NearWalletActions {
  create: (input: NearWalletCreateInput) => Promise<NearWalletStatus>;
  setBudget: (dailyBudgetUsd: string) => Promise<NearWalletStatus>;
  setAgents: (input: NearAgentsInput) => Promise<NearWalletStatus>;
  renewGrant: () => Promise<NearWalletStatus>;
  freeze: () => Promise<NearWalletStatus>;
  unfreeze: () => Promise<NearWalletStatus>;
  deposit: (assetId: string) => Promise<NearDepositAddress>;
  saveRule: (input: { domain: string; recipients: string[]; dailyUsd: number }) => Promise<NearWalletStatus>;
  removeRule: (domain: string) => Promise<NearWalletStatus>;
  allowPayment: (input: { requestId: string; dailyUsd: number }) => Promise<NearWalletStatus>;
  openSigning: () => Promise<void>;
  cancelSigning: () => Promise<NearWalletStatus>;
  checkBackup: () => Promise<NearWalletStatus>;
  disconnect: () => Promise<NearWalletStatus>;
}

export function NearIntentsLogo() {
  return (
    <span class="vault-logo vault-card-logo near-wallet-logo" aria-hidden="true">
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path
          d="M17.6 3.6 14 9a.4.4 0 0 0 .6.5l3.6-3.1c.1-.1.3 0 .3.1v10c0 .2-.2.2-.3.1L7.4 3.6A1.9 1.9 0 0 0 6 3h-.4A1.9 1.9 0 0 0 3.7 4.9v14.2A1.9 1.9 0 0 0 5.6 21a1.9 1.9 0 0 0 1.6-.9L10.8 15a.4.4 0 0 0-.6-.5l-3.6 3.1c-.1.1-.3 0-.3-.1v-10c0-.2.2-.2.3-.1l10.8 13a1.9 1.9 0 0 0 1.4.6h.4a1.9 1.9 0 0 0 1.9-1.9V4.9A1.9 1.9 0 0 0 19.2 3a1.9 1.9 0 0 0-1.6.6Z"
          fill="#111"
        />
      </svg>
    </span>
  );
}

const siteOf = (domain: string) => domain.split(".").slice(-2).join(".");

export function SiteIcon(props: { domain: string; class?: string | undefined }) {
  const sources = () => [...new Set([siteOf(props.domain), props.domain])].map((host) => `https://${host}/favicon.ico`);
  const [failed, setFailed] = createSignal<readonly string[]>([]);
  const source = () => sources().find((url) => !failed().includes(url));
  const letter = () => <span class="vault-letter">{siteOf(props.domain).charAt(0).toUpperCase()}</span>;
  return (
    <span class={`vault-logo integration-logo-tile near-site-icon ${props.class ?? ""}`} aria-hidden="true">
      <Show when={source()} keyed fallback={letter()}>
        {(url) => (
          <img
            src={url}
            alt=""
            decoding="async"
            referrerpolicy="no-referrer"
            onError={() => setFailed((list) => [...list, url])}
          />
        )}
      </Show>
    </span>
  );
}

function initialFocus(
  content: HTMLElement | undefined,
  options: { focusSearch?: boolean | undefined; focusCheckbox?: boolean | undefined },
) {
  if (options.focusSearch) return content?.querySelector<HTMLElement>("input[type=search]") ?? null;
  if (options.focusCheckbox) return content?.querySelector<HTMLElement>("input[type=checkbox]") ?? null;
  return null;
}

export function NearWalletDialog(props: {
  title: string;
  busy?: boolean | undefined;
  focusSearch?: boolean | undefined;
  focusCheckbox?: boolean | undefined;
  onClose: () => void;
  onSubmit?: (() => void) | undefined;
  children: JSX.Element;
  actions: JSX.Element;
}) {
  const { t } = useText();
  let content: HTMLElement | undefined;
  return (
    <Dialog.Root open={true} onOpenChange={(open) => !open && !props.busy && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay class="ui-confirm-dialog-overlay">
          <Dialog.Content
            as="section"
            class="ui-confirm-dialog vault-dialog near-wallet-dialog"
            ref={(element) => {
              content = element;
            }}
            onOpenAutoFocus={(event) => {
              const first = initialFocus(content, props);
              if (!first) return;
              event.preventDefault();
              first.focus({ preventScroll: true });
            }}
          >
            <form
              class="vault-dialog-form"
              onSubmit={(event) => {
                event.preventDefault();
                props.onSubmit?.();
              }}
            >
              <header class="vault-dialog-header">
                <NearIntentsLogo />
                <Dialog.Title as="h2" class="vault-dialog-title">
                  {props.title}
                </Dialog.Title>
                <IconButton label={t("common.close")} variant="ghost" disabled={props.busy} onClick={props.onClose}>
                  <X />
                </IconButton>
              </header>
              <div class="vault-dialog-body">{props.children}</div>
              <footer class="ui-confirm-dialog-actions">{props.actions}</footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const SETUP_SIGNATURES = [
  { title: "vault.near.signature.register", detail: "vault.near.signature.registerDetail", icon: KeyRound },
  { title: "vault.near.signature.create", detail: "vault.near.signature.createDetail", icon: ShieldCheck },
] as const;

export const SETUP_SIGNATURE_COUNT = SETUP_SIGNATURES.length;

type StepState = "next" | "current" | "done";

export type SignatureState = StepState | "failed";

const stepState = (index: number, current: number): StepState => {
  if (index < current) return "done";
  if (index === current) return "current";
  return "next";
};

const currentStep = (state: SignatureState) => (state === "current" ? "step" : undefined);

export function SetupSteps(props: { labels: readonly string[]; current: number }) {
  const { t } = useText();
  return (
    <ol class="near-wallet-steps" aria-label={t("vault.near.steps")}>
      <For each={props.labels}>
        {(label, index) => {
          const state = () => stepState(index(), props.current);
          return (
            <li data-state={state()} aria-current={currentStep(state())}>
              <span class="near-wallet-steps-line" aria-hidden="true" />
              <span>{label}</span>
            </li>
          );
        }}
      </For>
    </ol>
  );
}

function SignatureMark(props: { state: SignatureState; index: number }) {
  return (
    <Choose fallback={<span class="near-wallet-mark">{props.index + 1}</span>}>
      <Match when={props.state === "done"}>
        <span class="near-wallet-mark" data-tone="success">
          <Check size={14} />
        </span>
      </Match>
      <Match when={props.state === "current"}>
        <span class="near-wallet-mark" data-tone="busy">
          <Spinner />
        </span>
      </Match>
      <Match when={props.state === "failed"}>
        <span class="near-wallet-mark" data-tone="danger">
          <X size={14} />
        </span>
      </Match>
    </Choose>
  );
}

export function SetupSignatures(props: { active: number; failed: boolean; dailyBudgetUsd: string }) {
  const { t, format } = useText();
  const amount = () => format.currencyUsd(usdNumber(props.dailyBudgetUsd), { minimumFractionDigits: 0 });
  const state = (index: number): SignatureState => {
    const base = stepState(index, props.active);
    if (base === "current" && props.failed) return "failed";
    return base;
  };
  return (
    <ItemGroup class="settings-modal-card near-wallet-signatures" aria-label={t("vault.near.signature.label")}>
      <For each={SETUP_SIGNATURES}>
        {(signature, index) => (
          <Item class="near-wallet-signature" data-state={state(index())} aria-current={currentStep(state(index()))}>
            <ItemMedia class="near-wallet-signature-icon">
              <signature.icon size={18} aria-hidden="true" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t(signature.title)}</ItemTitle>
              <ItemDescription>{t(signature.detail, { amount: amount() })}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <SignatureMark state={state(index())} index={index()} />
            </ItemActions>
          </Item>
        )}
      </For>
    </ItemGroup>
  );
}

export function NearSigningWait(props: { onOpenAgain: () => Promise<void> }) {
  const { t } = useText();
  return (
    <div class="near-wallet-waiting" role="status">
      <Spinner />
      <Text tone="muted">{t("vault.near.waiting")}</Text>
      <div class="near-wallet-waiting-actions">
        <Button type="button" size="sm" variant="outline" onClick={() => void props.onOpenAgain()}>
          {t("vault.near.openAgain")}
        </Button>
      </div>
    </div>
  );
}

export function createNearRun() {
  const { t, errorMessage, sourceText } = useText();
  const [ui, setUi] = createStore<{ busy: boolean; failure: string | null }>({ busy: false, failure: null });
  async function run(action: () => Promise<NearWalletStatus | undefined>): Promise<boolean> {
    if (ui.busy) return false;
    setUi((draft) => {
      draft.busy = true;
      draft.failure = null;
    });
    try {
      const status = await action();
      const error = status ? status.error : null;
      setUi((draft) => {
        draft.failure = error ? sourceText(error) : null;
      });
      return error === null;
    } catch (error) {
      setUi((draft) => {
        draft.failure = errorMessage(error, t("vault.near.failed"));
      });
      return false;
    } finally {
      setUi((draft) => {
        draft.busy = false;
      });
    }
  }
  return {
    busy: () => ui.busy,
    failure: () => ui.failure,
    clear: () =>
      setUi((draft) => {
        draft.failure = null;
      }),
    run,
  };
}

export function NearFailure(props: { text: string | null }) {
  return (
    <Show when={props.text}>
      {(text) => (
        <Text as="p" variant="body-sm" tone="danger" role="alert">
          {text()}
        </Text>
      )}
    </Show>
  );
}

export function AllAgentsChoice(props: { checked: boolean; onChange: (on: boolean) => void }) {
  const { t } = useText();
  const id = `near-all-agents-${createUniqueId()}`;
  return (
    <ItemGroup class="settings-modal-card">
      <Item>
        <ItemContent>
          <ItemTitle id={id}>{t("vault.near.everyAgent")}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <Switch checked={props.checked} onChange={props.onChange} aria-labelledby={id} />
        </ItemActions>
      </Item>
    </ItemGroup>
  );
}

const matches = (query: string, text: string) => text.toLowerCase().includes(query.trim().toLowerCase());

export function AgentPicker(props: {
  agents: readonly NearWalletAgent[];
  label: string;
  checked: (agentId: string) => boolean;
  set: (agentIds: readonly string[], on: boolean) => void;
}) {
  const { t } = useText();
  const [search, setSearch] = createSignal("");
  const id = `near-agent-picker-${createUniqueId()}`;
  const shown = () => props.agents.filter((agent) => matches(search(), `${agent.name} ${agent.title ?? ""}`));
  const shownIds = () => shown().map((agent) => agent.id);
  const allOn = () => shown().length > 0 && shown().every((agent) => props.checked(agent.id));
  const allLabel = () =>
    search().trim()
      ? t("vault.near.allMatches", { count: shown().length })
      : t("vault.near.allAgents", { count: props.agents.length });
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  const none = () => (
    <Text as="p" variant="body-sm" tone="muted" class="near-wallet-picker-none">
      {t("vault.near.noAgentMatch", { query: search().trim() })}
    </Text>
  );
  return (
    <ItemGroup class="settings-modal-card near-wallet-picker" role="group" aria-label={props.label}>
      <div class="ui-search-select-search near-wallet-picker-search">
        <Search aria-hidden="true" />
        <Input
          type="search"
          class="ui-search-select-input near-wallet-picker-input"
          aria-label={t("vault.near.searchAgents")}
          placeholder={t("vault.near.searchAgents")}
          autocomplete="off"
          spellcheck={false}
          value={search()}
          onInput={(event) => {
            setSearch(event.currentTarget.value);
            fades.remeasure();
          }}
        />
      </div>
      <Show when={shown().length > 0} fallback={none()}>
        <div
          class={["near-wallet-picker-list", fades.classes()]}
          ref={(element) => fades.bind(element)}
          onScroll={fades.measure}
        >
          <Item class="near-wallet-picker-all">
            <ItemContent>
              <ItemTitle id={`${id}-all`}>{allLabel()}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Switch checked={allOn()} onChange={(on) => props.set(shownIds(), on)} aria-labelledby={`${id}-all`} />
            </ItemActions>
          </Item>
          <For each={shown()} keyed={(agent) => agent.id}>
            {(agent) => (
              <Item>
                <ItemMedia class="settings-agent-dock-avatar" aria-hidden="true">
                  <AgentAvatar agent={agent()} motion="idle" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle id={`${id}-${agent().id}`}>{agent().name}</ItemTitle>
                  <Show when={agent().title}>{(title) => <ItemDescription>{title()}</ItemDescription>}</Show>
                </ItemContent>
                <ItemActions>
                  <Switch
                    checked={props.checked(agent().id)}
                    onChange={(on) => props.set([agent().id], on)}
                    aria-labelledby={`${id}-${agent().id}`}
                  />
                </ItemActions>
              </Item>
            )}
          </For>
        </div>
      </Show>
    </ItemGroup>
  );
}

export function AgentStack(props: { agents: readonly NearWalletAgent[]; ids: readonly string[] }) {
  const shown = () => props.agents.filter((agent) => props.ids.includes(agent.id)).slice(0, 3);
  return (
    <span class="marketplace-skill-stack" aria-hidden="true">
      <For each={shown()} keyed={(agent) => agent.id}>
        {(agent) => (
          <span class="marketplace-avatar" data-size="xs">
            <AgentAvatar agent={agent()} motion="idle" />
          </span>
        )}
      </For>
    </span>
  );
}

export function RiskAccept(props: { accepted: boolean; onChange: (accepted: boolean) => void }) {
  const { t } = useText();
  const id = `near-wallet-accept-${createUniqueId()}`;
  return (
    <div class="near-wallet-risk-check">
      <TriangleAlert size={16} class="near-wallet-risk-icon" aria-hidden="true" />
      <Text as="p" variant="caption" tone="secondary">
        {t("vault.near.risk")}
      </Text>
      <Checkbox id={id} checked={props.accepted} onChange={(event) => props.onChange(event.currentTarget.checked)} />
      <span class="near-wallet-risk-label">
        <label for={id}>{t("vault.near.accept")}</label>{" "}
        <a href="https://docs.agentsonintents.com" target="_blank" rel="noreferrer">
          {t("vault.near.terms")}
        </a>
      </span>
    </div>
  );
}

const BACKUP_TEXT = {
  synced: { title: "vault.near.backup.synced", detail: "vault.near.backup.syncedDetail", tone: "success" },
  notSynced: { title: "vault.near.backup.notSynced", detail: "vault.near.backup.notSyncedDetail", tone: "warning" },
  deviceOnly: { title: "vault.near.backup.deviceOnly", detail: "vault.near.backup.deviceOnlyDetail", tone: "danger" },
  unknown: { title: "vault.near.backup.unknown", detail: "vault.near.backup.unknownDetail", tone: "warning" },
} as const;

export const backupText = (state: NearPasskeyBackup | null) => BACKUP_TEXT[state ?? "unknown"];

export function PasskeyBackupNotice(props: { state: NearPasskeyBackup | null; children?: JSX.Element }) {
  const { t } = useText();
  const text = () => backupText(props.state);
  return (
    <Alert tone={text().tone} report={false} class="near-wallet-risk">
      <AlertContent>
        <AlertTitle>{t(text().title)}</AlertTitle>
        <AlertDescription>{t(text().detail)}</AlertDescription>
        <AlertDescription>{t("vault.near.backup.noCopy")}</AlertDescription>
        {props.children}
      </AlertContent>
    </Alert>
  );
}

export function NearCheck(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = `near-wallet-check-${createUniqueId()}`;
  return (
    <div class="near-wallet-accept">
      <Checkbox id={id} checked={props.checked} onChange={(event) => props.onChange(event.currentTarget.checked)} />
      <label for={id}>{props.label}</label>
    </div>
  );
}

export function agentNames(format: TextValue["format"], agents: readonly NearWalletAgent[], ids: readonly string[]) {
  return format.list(ids.map((id) => agents.find((agent) => agent.id === id)?.name ?? id));
}

export const usdNumber = (text: string | null | undefined) => {
  const value = Number(text ?? 0);
  return Number.isFinite(value) ? value : 0;
};
