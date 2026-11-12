import type {
  VaultCardBrand,
  VaultCardSummary,
  VaultContactFields,
  VaultContactSummary,
  VaultImportResult,
  VaultItemKind,
  VaultItemSummary,
  VaultSaveInput,
  VaultSecretField,
  VaultSecretRequest,
  VaultState,
  VaultTwoStepCodes,
} from "@openbot/contracts/ipc";
import {
  API_KEY_NAME_PATTERN,
  cardBrand,
  VAULT_API_KEY_LIMIT,
  VAULT_COUNTRY_CODES,
  VAULT_NOTES_LIMIT,
  VAULT_PASSWORD_LIMIT,
  VAULT_TEXT_LIMIT,
  vaultExpiryText,
} from "@openbot/contracts/ipc";
import { normalizeTwoStepKey } from "@openbot/contracts/two-step-code";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  buttonVariants,
  ChevronDown,
  ConfirmDialog,
  Copy,
  CreditCard,
  Dialog,
  DropdownMenu,
  Ellipsis,
  ErrorReference,
  Eye,
  EyeOff,
  Field,
  Globe2,
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
  KeySquare,
  NativeSelect,
  Pencil,
  Search,
  SettingsSection,
  ShieldCheck,
  SlidingTabs,
  Text,
  Textarea,
  Trash2,
  Upload,
  UserRound,
  userInitials,
  X,
} from "@openbot/ui";
import type { UserErrorDetails } from "@openbot/user-errors";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, createStore, For, Match, Show, Switch, untrack } from "solid-js";
import { useText } from "../../text";
import { type VaultAgentChoice, type VaultAgentScope, VaultAgentsButton } from "./VaultAgents";
import { VaultLinkAccount, type VaultLinkAccountProps } from "./VaultLinkAccount";
import {
  createDraftTwoStepCode,
  createSavedTwoStepCodes,
  type LiveTwoStepCode,
  TwoStepCheckStep,
  TwoStepKeyStep,
  TwoStepRow,
  TwoStepRowCode,
} from "./vault-two-step";

export interface VaultPanelProps {
  state: VaultState;
  /** False for a server that cannot keep API keys: the kind is not offered. */
  apiKeys: boolean;
  /** Adds an item when `id` is null. A null secret keeps the saved value. */
  onSave: (input: VaultSaveInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** The saved password, card number, security code or API key, for the edit dialog. */
  onReveal: (request: VaultSecretRequest) => Promise<string>;
  /** Puts the saved value on the clipboard. On desktop the value does not come to this window. */
  onCopy: (request: VaultSecretRequest) => Promise<void>;
  /** Puts a username, an address or a two-step code on the clipboard. */
  onCopyText: (value: string) => Promise<void>;
  /**
   * The current two-step code of each login with a key. Absent for a server that cannot keep two-step
   * keys: the dialog does not offer them.
   */
  onCodes?: (() => Promise<VaultTwoStepCodes>) | undefined;
  /** Opens the file dialog. Null when the user closes it. Absent for a host without CSV import. */
  onImportCsv?: (() => Promise<VaultImportResult>) | undefined;
  /** Deletes the Vault file that cannot be read, and starts again with no items. */
  onReset: () => Promise<void>;
  /** Where the menus open, so they stay inside the settings page. */
  menuMount?: HTMLElement | undefined;
  /** The Link account of this computer, above the cards. Absent for a joined server. */
  link?: Omit<VaultLinkAccountProps, "menuMount"> | undefined;
  /**
   * The agents of the server, so the user chooses the agents of each item. Absent while they did not
   * load, or for a server that does not keep the agents of an item (`state.agentScope`).
   */
  agents?: readonly VaultAgentChoice[] | undefined;
}

export type { VaultAgentChoice };

type Filter = VaultItemKind | "all";

const FILTERS = [
  { value: "all", label: "vault.filter.all", empty: "vault.empty" },
  { value: "login", label: "vault.filter.login", empty: "vault.emptyLogin" },
  { value: "card", label: "vault.filter.card", empty: "vault.emptyCard" },
  { value: "contact", label: "vault.filter.contact", empty: "vault.emptyContact" },
  { value: "apiKey", label: "vault.filter.apiKey", empty: "vault.emptyApiKey" },
] as const satisfies readonly { value: Filter; label: AppTextKey; empty: AppTextKey }[];

const isFilter = (value: string): value is Filter => FILTERS.some((item) => item.value === value);

const KIND_LABEL = {
  login: "vault.kind.login",
  card: "vault.kind.card",
  contact: "vault.kind.contact",
  apiKey: "vault.kind.apiKey",
} as const satisfies Record<VaultItemKind, AppTextKey>;

const NEW_TITLE = {
  login: "vault.newLogin",
  card: "vault.newCard",
  contact: "vault.newContact",
  apiKey: "vault.newApiKey",
} as const satisfies Record<VaultItemKind, AppTextKey>;

/** Brand names are not translated. */
const BRAND_NAME: Record<VaultCardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
};

/** The words in the Visa and Amex marks. They are artwork, so they are not translated. */
const BRAND_MARK = { visa: "VISA", amex: "AMEX" } as const;

const SECRET_TEXT = {
  password: { show: "vault.showPassword", hide: "vault.hidePassword", copy: "vault.copyPassword" },
  number: { show: "vault.showNumber", hide: "vault.hideNumber", copy: "vault.copyNumber" },
  securityCode: { show: "vault.showSecurityCode", hide: "vault.hideSecurityCode", copy: "vault.copySecurityCode" },
  key: { show: "vault.showKey", hide: "vault.hideKey", copy: "vault.copyKey" },
} as const satisfies Record<VaultSecretField, { show: AppTextKey; hide: AppTextKey; copy: AppTextKey }>;

const digitsOf = (value: string) => value.replace(/\D/gu, "");

/** `MM/YY` or `MM/YYYY`, or null when the text is not a date. */
function parseExpiry(text: string): { month: number; year: number } | null {
  const match = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/u.exec(text);
  if (!match?.[1] || !match[2]) return null;
  const month = Number(match[1]);
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return month >= 1 && month <= 12 ? { month, year } : null;
}

type LoginDraft = {
  kind: "login";
  website: string;
  username: string;
  notes: string;
  password: string;
  /** A new two-step key that the user typed. The saved key never comes to this window. */
  twoStepKey: string;
  /** The user removed the saved two-step key. */
  twoStepRemoved: boolean;
};
type CardDraft = {
  kind: "card";
  label: string;
  nameOnCard: string;
  number: string;
  expiry: string;
  securityCode: string;
  billingContactId: string;
  /** The sites where agents can fill the card with no approval. The user can only remove one. */
  fillSites: string[];
};
type ContactDraft = { kind: "contact" } & VaultContactFields;
type ApiKeyDraft = { kind: "apiKey"; name: string; notes: string; key: string };
type Draft = LoginDraft | CardDraft | ContactDraft | ApiKeyDraft;

const EMPTY_CONTACT: VaultContactFields = {
  label: "",
  fullName: "",
  address: "",
  address2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
  phone: "",
  email: "",
};

/** The secret fields of a saved item start empty: the user reveals or replaces them. */
function draftOf(kind: VaultItemKind, item: VaultItemSummary | null): Draft {
  if (kind === "login")
    return item?.kind === "login"
      ? {
          kind,
          website: item.website,
          username: item.username,
          notes: item.notes,
          password: "",
          twoStepKey: "",
          twoStepRemoved: false,
        }
      : { kind, website: "", username: "", notes: "", password: "", twoStepKey: "", twoStepRemoved: false };
  if (kind === "card")
    return item?.kind === "card"
      ? {
          kind,
          label: item.label,
          nameOnCard: item.nameOnCard,
          number: "",
          expiry: vaultExpiryText(item.expMonth, item.expYear),
          securityCode: "",
          billingContactId: item.billingContactId ?? "",
          fillSites: item.fillSites,
        }
      : {
          kind,
          label: "",
          nameOnCard: "",
          number: "",
          expiry: "",
          securityCode: "",
          billingContactId: "",
          fillSites: [],
        };
  if (kind === "apiKey")
    return item?.kind === "apiKey"
      ? { kind, name: item.name, notes: item.notes, key: "" }
      : { kind, name: "", notes: "", key: "" };
  if (item?.kind === "contact") {
    const { id: _id, kind: _kind, ...fields } = item;
    return { kind, ...fields };
  }
  return { kind, ...EMPTY_CONTACT };
}

/** The values that a chat request filled in, over a new item's draft. A secret field is never one of them. */
function prefilled(draft: Draft, values: Readonly<Record<string, string>>): Draft {
  const value = (key: string, current: string) => values[key] ?? current;
  switch (draft.kind) {
    case "login":
      return { ...draft, website: value("website", draft.website), username: value("username", draft.username) };
    case "card":
      return {
        ...draft,
        label: value("label", draft.label),
        nameOnCard: value("nameOnCard", draft.nameOnCard),
        expiry: value("expiry", draft.expiry),
      };
    case "contact":
      return {
        ...draft,
        label: value("label", draft.label),
        fullName: value("fullName", draft.fullName),
        address: value("address", draft.address),
        address2: value("address2", draft.address2),
        city: value("city", draft.city),
        region: value("region", draft.region),
        postalCode: value("postalCode", draft.postalCode),
        country: value("country", draft.country).toUpperCase(),
        phone: value("phone", draft.phone),
        email: value("email", draft.email),
      };
    case "apiKey":
      return { ...draft, name: value("name", draft.name) };
  }
}

/** Whether a draft has the fields that the item needs. A saved secret counts as present. */
function draftReady(draft: Draft, saved: VaultItemSummary | null): boolean {
  if (draft.kind === "login")
    return Boolean(draft.website.trim() && (draft.password || (saved?.kind === "login" && saved.hasPassword)));
  if (draft.kind === "card") {
    const digits = digitsOf(draft.number);
    const numberReady = digits.length >= 12 || (digits.length === 0 && saved?.kind === "card");
    const codeReady = draft.securityCode === "" || /^\d{3,4}$/u.test(draft.securityCode.trim());
    return numberReady && codeReady && parseExpiry(draft.expiry) !== null;
  }
  if (draft.kind === "apiKey")
    return (
      API_KEY_NAME_PATTERN.test(draft.name.trim()) &&
      (draft.key.trim() !== "" || (saved?.kind === "apiKey" && saved.hasKey))
    );
  // The same rule as main: a label alone is not contact info.
  return [draft.fullName, draft.address, draft.phone, draft.email].some((field) => field.trim() !== "");
}

/** A new key, an empty text that removes the saved key, or nothing, which keeps it. */
function twoStepKeyInput(draft: LoginDraft): { twoStepKey?: string } {
  const typed = normalizeTwoStepKey(draft.twoStepKey);
  if (typed !== null) return { twoStepKey: typed };
  return draft.twoStepRemoved ? { twoStepKey: "" } : {};
}

/**
 * The item with its agents. Undefined agents keep the saved choice: a server without `vault-v4`, or a
 * request from the chat, which makes an item for every agent.
 */
function saveInput(draft: Draft, id: string | null, agents: VaultAgentScope | undefined): VaultSaveInput {
  const item = itemInput(draft, id);
  return agents === undefined ? item : { ...item, agents: agents === null ? null : [...agents] };
}

/** An empty secret field keeps the saved value. */
function itemInput(draft: Draft, id: string | null): VaultSaveInput {
  if (draft.kind === "login")
    return {
      kind: "login",
      id,
      website: draft.website.trim(),
      username: draft.username.trim(),
      notes: draft.notes,
      password: draft.password === "" ? null : draft.password,
      ...twoStepKeyInput(draft),
    };
  if (draft.kind === "card") {
    const expiry = parseExpiry(draft.expiry) ?? { month: 0, year: 0 };
    const number = digitsOf(draft.number);
    const securityCode = draft.securityCode.trim();
    return {
      kind: "card",
      id,
      label: draft.label.trim(),
      nameOnCard: draft.nameOnCard.trim(),
      expMonth: expiry.month,
      expYear: expiry.year,
      billingContactId: draft.billingContactId || null,
      number: number === "" ? null : number,
      securityCode: securityCode === "" ? null : securityCode,
      fillSites: draft.fillSites,
    };
  }
  if (draft.kind === "apiKey")
    return {
      kind: "apiKey",
      id,
      name: draft.name.trim(),
      notes: draft.notes,
      key: draft.key.trim() === "" ? null : draft.key,
    };
  const { kind: _kind, ...fields } = draft;
  return { kind: "contact", id, ...fields };
}

function itemMatches(item: VaultItemSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const text =
    item.kind === "login"
      ? [item.website, item.username, item.notes]
      : item.kind === "card"
        ? [item.label, item.nameOnCard, item.last4, item.brand ? BRAND_NAME[item.brand] : ""]
        : item.kind === "apiKey"
          ? [item.name, item.notes]
          : [item.label, item.fullName, item.address, item.city, item.email, item.phone];
  return text.some((value) => value.toLowerCase().includes(needle));
}

/** The countries that a contact can have, by name in the reader's language. */
function useCountries() {
  const { locale } = useText();
  const regionNames = createMemo(() => new Intl.DisplayNames([locale()], { type: "region" }));
  const countryName = (code: string) => (code ? (regionNames().of(code) ?? code) : "");
  const countries = createMemo(() =>
    VAULT_COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)),
  );
  return { countryName, countries };
}

/**
 * The Vault of the computer that runs the agents, in its server settings: filter tabs with counts,
 * one list, and a dialog to add or edit an item. A list item never carries a password, a card number,
 * a security code or an API key; the edit dialog asks for one only when the user shows it.
 */
export function VaultPanel(props: VaultPanelProps) {
  const { t, errorDetails } = useText();
  const [filter, setFilter] = createSignal<Filter>("all");
  const [query, setQuery] = createSignal("");
  const [ui, setUi] = createStore<{
    editing: { kind: VaultItemKind; item: VaultItemSummary | null } | null;
    deleting: VaultItemSummary | null;
    importing: boolean;
    resetting: boolean;
    failure: UserErrorDetails | null;
    notice: string | null;
  }>({ editing: null, deleting: null, importing: false, resetting: false, failure: null, notice: null });

  const { countryName, countries } = useCountries();
  const contactLine = (contact: VaultContactFields) =>
    [contact.address, contact.city, contact.postalCode, countryName(contact.country)].filter(Boolean).join(", ");
  const maskedCard = (card: Pick<VaultCardSummary, "brand" | "last4">) =>
    t("vault.maskedCard", { brand: card.brand ? BRAND_NAME[card.brand] : t("vault.kind.card"), last4: card.last4 });

  const itemTitle = (item: VaultItemSummary) => {
    if (item.kind === "login") return item.website || t("vault.untitledLogin");
    if (item.kind === "card") return item.label || maskedCard(item);
    if (item.kind === "apiKey") return item.name;
    return item.label || item.fullName || t("vault.untitledContact");
  };
  const itemDetail = (item: VaultItemSummary) => {
    if (item.kind === "login") return item.username || t("vault.noUsername");
    if (item.kind === "card")
      return t("vault.cardSummary", { last4: item.last4, expiry: vaultExpiryText(item.expMonth, item.expYear) });
    if (item.kind === "apiKey") return item.notes || t("vault.kind.apiKey");
    return contactLine(item) || item.email || item.phone;
  };
  // An item that an agent added names the agent, so the user can find what agents saved.
  const itemSummary = (item: VaultItemSummary) =>
    [itemDetail(item), item.addedBy ? t("vault.addedBy", { agent: item.addedBy }) : ""].filter(Boolean).join(" · ");

  // A new list after each saved change, so a replaced key loads its code again.
  const keyedLogins = createMemo(() =>
    props.state.items.filter((item) => item.kind === "login" && item.hasTwoStep).map((item) => item.id),
  );
  const twoStepCodes = createSavedTwoStepCodes(() => props.onCodes, keyedLogins);
  const editingCode = () => {
    const item = ui.editing?.item;
    return item ? twoStepCodes.code(item.id) : undefined;
  };
  const copyCode = (code: string) => void run(() => props.onCopyText(code), "vault.copyFailed");
  const ready = () => props.state.status === "ready";
  const filters = () => FILTERS.filter((item) => item.value !== "apiKey" || props.apiKeys);
  const contacts = () => props.state.items.filter((item): item is VaultContactSummary => item.kind === "contact");
  const count = (kind: Filter) => props.state.items.filter((item) => kind === "all" || item.kind === kind).length;
  const visible = (kind: Filter) =>
    props.state.items.filter((item) => (kind === "all" || item.kind === kind) && itemMatches(item, query()));
  const empty = () => props.state.items.length === 0;
  /** The agents to choose from, when the server keeps the agents of each item. */
  const agentChoices = () => (props.state.agentScope && props.agents?.length ? props.agents : undefined);
  /** Changes only the agents of a saved item: each other field and secret keeps its saved value. */
  const saveAgents = (item: VaultItemSummary, agents: VaultAgentScope) =>
    run(() => props.onSave(saveInput(draftOf(item.kind, item), item.id, agents)));

  /** Runs one change of a confirm dialog. A failure stays in the dialog. */
  async function run(action: () => Promise<void>, fallback: AppTextKey = "vault.failed"): Promise<boolean> {
    setUi((draft) => {
      draft.failure = null;
      draft.notice = null;
    });
    try {
      await action();
      return true;
    } catch (error) {
      setUi((draft) => {
        draft.failure = errorDetails(error, t(fallback));
      });
      return false;
    }
  }

  const closeDialogs = () =>
    setUi((draft) => {
      draft.editing = null;
      draft.deleting = null;
      draft.importing = false;
      draft.resetting = false;
      draft.failure = null;
    });

  async function importCsv(): Promise<void> {
    let result: VaultImportResult = null;
    const done = await run(async () => {
      result = (await props.onImportCsv?.()) ?? null;
    });
    const imported: VaultImportResult = result;
    if (!done || imported === null) return;
    const { imported: added, skipped } = imported;
    closeDialogs();
    setUi((draft) => {
      draft.notice = t("vault.importDone", { imported: String(added), skipped: String(skipped) });
    });
  }

  const editingTitle = (editing: { kind: VaultItemKind; item: VaultItemSummary | null }) =>
    editing.item ? itemTitle(editing.item) : t(NEW_TITLE[editing.kind]);

  const openEdit = (kind: VaultItemKind, item: VaultItemSummary | null) =>
    setUi((draft) => {
      draft.failure = null;
      draft.notice = null;
      draft.editing = { kind, item };
    });

  return (
    <div class="vault-panel">
      <Switch>
        <Match when={props.state.status === "unavailable"}>
          <Alert tone="warning" report={false}>
            <AlertIcon>
              <ShieldCheck />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>{t("vault.unavailableTitle")}</AlertTitle>
              <AlertDescription>{t("vault.unavailableDescription")}</AlertDescription>
            </AlertContent>
          </Alert>
        </Match>
        <Match when={props.state.status === "unreadable"}>
          <Alert tone="warning" report={false}>
            <AlertIcon>
              <ShieldCheck />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>{t("vault.unreadableTitle")}</AlertTitle>
              <AlertDescription>{t("vault.unreadableDescription")}</AlertDescription>
            </AlertContent>
            <AlertActions>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setUi((draft) => {
                    draft.failure = null;
                    draft.resetting = true;
                  })
                }
              >
                {t("vault.reset")}
              </Button>
            </AlertActions>
          </Alert>
        </Match>
      </Switch>
      <Show when={ready()}>
        <SlidingTabs.Root value={filter()} onChange={(value) => isFilter(value) && setFilter(value)}>
          <SettingsSection
            title={t("vault.items.title")}
            description={t(props.state.agentScope ? "vault.items.scopedDescription" : "vault.items.description")}
            actions={
              <NewItemMenu
                kinds={filters().flatMap((item) => (item.value === "all" ? [] : [item.value]))}
                mount={props.menuMount}
                onNew={(kind) => openEdit(kind, null)}
                onImport={
                  props.onImportCsv
                    ? () =>
                        setUi((draft) => {
                          draft.failure = null;
                          draft.notice = null;
                          draft.importing = true;
                        })
                    : undefined
                }
              />
            }
          >
            <div class="vault-toolbar">
              <SlidingTabs.List aria-label={t("vault.filter.label")}>
                <For each={filters()}>
                  {(item) => (
                    <SlidingTabs.Trigger value={item.value}>
                      {t(item.label)} <span class="vault-count">{count(item.value)}</span>
                    </SlidingTabs.Trigger>
                  )}
                </For>
              </SlidingTabs.List>
              <Show when={!empty()}>
                <label class="server-settings-search">
                  <Search aria-hidden="true" />
                  <span class="sr-only">{t("vault.search")}</span>
                  <Input
                    size="sm"
                    type="search"
                    placeholder={t("vault.search")}
                    value={query()}
                    onValueChange={setQuery}
                  />
                </label>
              </Show>
            </div>
            <Show when={ui.notice}>
              {(notice) => (
                <Text variant="caption" tone="muted" role="status">
                  {notice()}
                </Text>
              )}
            </Show>
            <Show when={!ui.editing && !ui.deleting && !ui.importing && ui.failure}>
              {(failure) => (
                <Text tone="danger" variant="caption" role="alert">
                  {failure().message}
                  <ErrorReference reference={failure().reference} />
                </Text>
              )}
            </Show>
            <SlidingTabs.ContentSlot>
              <For each={filters()}>
                {(tab) => (
                  <SlidingTabs.Content value={tab.value}>
                    <Show when={tab.value === "card" && props.link}>
                      {(link) => (
                        <VaultLinkAccount
                          status={link().status}
                          onConnect={link().onConnect}
                          onCancel={link().onCancel}
                          onDisconnect={link().onDisconnect}
                          menuMount={props.menuMount}
                        />
                      )}
                    </Show>
                    <ItemGroup class="settings-modal-card" surface="subtle" aria-label={t(tab.label)}>
                      <Show
                        when={visible(tab.value).length > 0}
                        fallback={
                          <Item class="server-settings-empty-row">
                            <ItemContent>
                              <ItemDescription>
                                {empty()
                                  ? t("vault.empty")
                                  : query()
                                    ? t("vault.noMatch", { query: query() })
                                    : t(tab.empty)}
                              </ItemDescription>
                            </ItemContent>
                          </Item>
                        }
                      >
                        <For each={visible(tab.value)}>
                          {(item) => (
                            <Item class="settings-modal-row integrations-hub-row">
                              <Button
                                type="button"
                                variant="ghost"
                                class="integrations-hub-hitarea"
                                aria-label={t("vault.edit", { name: itemTitle(item) })}
                                onClick={() => openEdit(item.kind, item)}
                              />
                              <ItemMedia>
                                <ItemLogo item={item} />
                              </ItemMedia>
                              <ItemContent>
                                <ItemTitle class="vault-truncate">{itemTitle(item)}</ItemTitle>
                                <ItemDescription class="vault-truncate">{itemSummary(item)}</ItemDescription>
                              </ItemContent>
                              <ItemActions class="integrations-hub-actions">
                                <Show when={agentChoices()}>
                                  {(agents) => (
                                    <VaultAgentsButton
                                      name={itemTitle(item)}
                                      agents={agents()}
                                      scope={item.agents ?? null}
                                      onChange={async (scope) => {
                                        await saveAgents(item, scope);
                                      }}
                                    />
                                  )}
                                </Show>
                                <Show when={twoStepCodes.code(item.id)}>
                                  {(code) => (
                                    <TwoStepRowCode
                                      code={code()}
                                      now={twoStepCodes.now()}
                                      site={itemTitle(item)}
                                      onCopy={copyCode}
                                    />
                                  )}
                                </Show>
                                <ItemMenu
                                  item={item}
                                  title={itemTitle(item)}
                                  address={item.kind === "contact" ? contactLine(item) : ""}
                                  mount={props.menuMount}
                                  onEdit={() => openEdit(item.kind, item)}
                                  onDelete={() =>
                                    setUi((draft) => {
                                      draft.failure = null;
                                      draft.notice = null;
                                      draft.deleting = item;
                                    })
                                  }
                                  onCopySecret={(field) =>
                                    void run(() => props.onCopy({ id: item.id, field }), "vault.copyFailed")
                                  }
                                  onCopyText={(value) => void run(() => props.onCopyText(value), "vault.copyFailed")}
                                />
                              </ItemActions>
                            </Item>
                          )}
                        </For>
                      </Show>
                    </ItemGroup>
                  </SlidingTabs.Content>
                )}
              </For>
            </SlidingTabs.ContentSlot>
          </SettingsSection>
        </SlidingTabs.Root>
      </Show>
      <Show when={ui.editing}>
        {(editing) => (
          <ItemDialog
            kind={editing().kind}
            item={editing().item}
            contacts={contacts()}
            countries={countries()}
            contactLine={contactLine}
            title={editingTitle(editing())}
            twoStep={props.onCodes !== undefined}
            agents={agentChoices()}
            savedCode={editingCode()}
            onCopyCode={copyCode}
            onSave={(input) => props.onSave(input)}
            onReveal={props.onReveal}
            onClose={closeDialogs}
          />
        )}
      </Show>
      <ConfirmDialog
        open={ui.deleting !== null}
        title={t("vault.deleteTitle", { name: ui.deleting ? itemTitle(ui.deleting) : "" })}
        description={t("vault.deleteDescription")}
        confirmLabel={t("common.delete")}
        error={ui.deleting && ui.failure ? <FailureText failure={ui.failure} /> : undefined}
        onCancel={closeDialogs}
        onConfirm={async () => {
          const item = ui.deleting;
          if (item && (await run(() => props.onDelete(item.id)))) closeDialogs();
        }}
      />
      <ConfirmDialog
        open={ui.importing}
        tone="default"
        icon={<Upload />}
        title={t("vault.importTitle")}
        description={t("vault.importDescription")}
        confirmLabel={t("vault.importChoose")}
        error={ui.importing && ui.failure ? <FailureText failure={ui.failure} /> : undefined}
        onCancel={closeDialogs}
        onConfirm={importCsv}
      />
      <ConfirmDialog
        open={ui.resetting}
        title={t("vault.resetTitle")}
        description={t("vault.resetDescription")}
        confirmLabel={t("vault.reset")}
        error={ui.resetting && ui.failure ? <FailureText failure={ui.failure} /> : undefined}
        onCancel={closeDialogs}
        onConfirm={async () => {
          if (await run(() => props.onReset())) closeDialogs();
        }}
      />
    </div>
  );
}

function FailureText(props: { failure: UserErrorDetails }) {
  return (
    <>
      {props.failure.message}
      <ErrorReference reference={props.failure.reference} />
    </>
  );
}

function KindIcon(props: { kind: VaultItemKind }) {
  return (
    <span class="vault-icon" aria-hidden="true">
      <Switch>
        <Match when={props.kind === "login"}>
          <KeyRound />
        </Match>
        <Match when={props.kind === "card"}>
          <CreditCard />
        </Match>
        <Match when={props.kind === "contact"}>
          <UserRound />
        </Match>
        <Match when={props.kind === "apiKey"}>
          <KeySquare />
        </Match>
      </Switch>
    </span>
  );
}

function ApiKeyLogo() {
  return (
    <span class="vault-logo integration-logo-tile" aria-hidden="true">
      <KeySquare />
    </span>
  );
}

/** The first letter of a site. No icon is fetched: the page would learn which sites are saved. */
const siteLetter = (website: string) =>
  website
    .trim()
    .replace(/^[a-z]+:\/\//iu, "")
    .replace(/^www\./iu, "")
    .charAt(0)
    .toUpperCase();

function SiteLogo(props: { website: string }) {
  return (
    <span class="vault-logo integration-logo-tile" aria-hidden="true">
      <Show when={siteLetter(props.website)} fallback={<KeyRound />}>
        {(letter) => (/\d/u.test(letter()) ? <Globe2 /> : <span class="vault-letter">{letter()}</span>)}
      </Show>
    </span>
  );
}

/**
 * The card brand on a small card. Lucide has no payment brands, so the marks are drawn here in the
 * brands' fixed colours. An unknown brand shows the generic card icon.
 */
function CardLogo(props: { brand: VaultCardBrand | null }) {
  return (
    <span class="vault-logo vault-card-logo" aria-hidden="true">
      <Switch fallback={<CreditCard />}>
        <Match when={props.brand === "visa"}>
          <svg aria-hidden="true" viewBox="0 0 40 14">
            <text
              x="20"
              y="11.5"
              fill="#1a1f71"
              font-family="Arial, Helvetica, sans-serif"
              font-size="13"
              font-style="italic"
              font-weight="800"
              text-anchor="middle"
            >
              {BRAND_MARK.visa}
            </text>
          </svg>
        </Match>
        <Match when={props.brand === "mastercard"}>
          <svg aria-hidden="true" viewBox="0 0 24 16">
            <circle cx="9" cy="8" r="6" fill="#eb001b" />
            <circle cx="15" cy="8" r="6" fill="#f79e1b" />
            <path d="M12 2.8A6 6 0 0 1 12 13.2 6 6 0 0 1 12 2.8Z" fill="#ff5f00" />
          </svg>
        </Match>
        <Match when={props.brand === "amex"}>
          <svg aria-hidden="true" viewBox="0 0 40 14">
            <rect width="40" height="14" rx="2" fill="#2e77bc" />
            <text
              x="20"
              y="10.5"
              fill="#ffffff"
              font-family="Arial, Helvetica, sans-serif"
              font-size="9"
              font-weight="800"
              text-anchor="middle"
            >
              {BRAND_MARK.amex}
            </text>
          </svg>
        </Match>
      </Switch>
    </span>
  );
}

/** The initials of the person, in the same style as an account avatar. */
function ContactLogo(props: { name: string }) {
  const initials = () => (props.name.trim() ? userInitials({ name: props.name.trim(), email: "" }) : "");
  return (
    <span class="vault-logo vault-avatar" aria-hidden="true">
      <Show when={initials()} fallback={<UserRound />}>
        {initials()}
      </Show>
    </span>
  );
}

function ItemLogo(props: { item: VaultItemSummary }) {
  return (
    <Switch>
      <Match when={props.item.kind === "login" ? props.item : undefined}>
        {(login) => <SiteLogo website={login().website} />}
      </Match>
      <Match when={props.item.kind === "card" ? props.item : undefined}>
        {(card) => <CardLogo brand={card().brand} />}
      </Match>
      <Match when={props.item.kind === "contact" ? props.item : undefined}>
        {(contact) => <ContactLogo name={contact().fullName || contact().label} />}
      </Match>
      <Match when={props.item.kind === "apiKey"}>
        <ApiKeyLogo />
      </Match>
    </Switch>
  );
}

function DraftLogo(props: { draft: Draft; saved: VaultItemSummary | null }) {
  const draftBrand = (draft: CardDraft) =>
    draft.number ? cardBrand(digitsOf(draft.number)) : props.saved?.kind === "card" ? props.saved.brand : null;
  return (
    <Switch>
      <Match when={props.draft.kind === "login" ? props.draft : undefined}>
        {(login) => <SiteLogo website={login().website} />}
      </Match>
      <Match when={props.draft.kind === "card" ? props.draft : undefined}>
        {(card) => <CardLogo brand={draftBrand(card())} />}
      </Match>
      <Match when={props.draft.kind === "contact" ? props.draft : undefined}>
        {(contact) => <ContactLogo name={contact().fullName || contact().label} />}
      </Match>
      <Match when={props.draft.kind === "apiKey"}>
        <ApiKeyLogo />
      </Match>
    </Switch>
  );
}

/** The ⋯ menu of a row: edit, copy, delete. A secret goes to the clipboard from main. */
function ItemMenu(props: {
  item: VaultItemSummary;
  title: string;
  address: string;
  mount: HTMLElement | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onCopySecret: (field: VaultSecretField) => void;
  onCopyText: (value: string) => void;
}) {
  const { t } = useText();
  const secrets = (): VaultSecretField[] => {
    const item = props.item;
    if (item.kind === "login") return item.hasPassword ? ["password"] : [];
    if (item.kind === "apiKey") return item.hasKey ? ["key"] : [];
    return item.kind === "card" ? ["number", "securityCode"] : [];
  };
  const username = () => (props.item.kind === "login" ? props.item.username : "");
  const variableName = () => (props.item.kind === "apiKey" ? props.item.name : "");
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button`}
        aria-label={t("vault.actionsFor", { name: props.title })}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.Content>
          <DropdownMenu.Item onSelect={() => props.onEdit()}>
            <Pencil aria-hidden="true" />
            {t("common.edit")}
          </DropdownMenu.Item>
          <Show when={username()}>
            {(value) => (
              <DropdownMenu.Item onSelect={() => props.onCopyText(value())}>
                <Copy aria-hidden="true" />
                {t("vault.copyUsername")}
              </DropdownMenu.Item>
            )}
          </Show>
          <Show when={variableName()}>
            {(value) => (
              <DropdownMenu.Item onSelect={() => props.onCopyText(value())}>
                <Copy aria-hidden="true" />
                {t("vault.copyVariableName")}
              </DropdownMenu.Item>
            )}
          </Show>
          <For each={secrets()}>
            {(field) => (
              <DropdownMenu.Item onSelect={() => props.onCopySecret(field)}>
                <Copy aria-hidden="true" />
                {t(SECRET_TEXT[field].copy)}
              </DropdownMenu.Item>
            )}
          </For>
          <Show when={props.address}>
            {(address) => (
              <DropdownMenu.Item onSelect={() => props.onCopyText(address())}>
                <Copy aria-hidden="true" />
                {t("vault.copyAddress")}
              </DropdownMenu.Item>
            )}
          </Show>
          <DropdownMenu.Separator />
          <DropdownMenu.Item class="ui-action-menu-danger" onSelect={() => props.onDelete()}>
            <Trash2 aria-hidden="true" />
            {t("common.delete")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** "New item" with each kind that the server keeps, and the import when the server has one. */
function NewItemMenu(props: {
  kinds: readonly VaultItemKind[];
  mount: HTMLElement | undefined;
  onNew: (kind: VaultItemKind) => void;
  onImport: (() => void) | undefined;
}) {
  const { t } = useText();
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger class={buttonVariants({ variant: "default", size: "sm" })}>
        {t("vault.newItem")}
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.Content>
          <For each={props.kinds}>
            {(kind) => (
              <DropdownMenu.Item onSelect={() => props.onNew(kind)}>
                <KindIcon kind={kind} />
                {t(KIND_LABEL[kind])}
              </DropdownMenu.Item>
            )}
          </For>
          <Show when={props.onImport}>
            {(onImport) => (
              <>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => onImport()()}>
                  <Upload aria-hidden="true" />
                  {t("vault.importMenu")}
                </DropdownMenu.Item>
              </>
            )}
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * A secret field: hidden until the user shows it. For a saved item it starts empty, and the eye
 * button asks for the saved value; an empty field keeps it.
 */
function SecretInput(props: {
  field: VaultSecretField;
  value: string;
  saved: boolean;
  maxlength: number;
  inputMode?: "numeric";
  placeholder?: string | undefined;
  onChange: (value: string) => void;
  onReveal: () => Promise<string>;
  onRevealFailed: (error: unknown) => void;
}) {
  const { t } = useText();
  const [shown, setShown] = createSignal(false);
  const [revealing, setRevealing] = createSignal(false);
  async function toggle(): Promise<void> {
    if (shown()) return void setShown(false);
    if (props.saved && props.value === "") {
      setRevealing(true);
      try {
        props.onChange(await props.onReveal());
      } catch (error) {
        props.onRevealFailed(error);
        return;
      } finally {
        setRevealing(false);
      }
    }
    setShown(true);
  }
  return (
    <div class="vault-secret">
      <Input
        type={shown() ? "text" : "password"}
        autocomplete="off"
        spellcheck={false}
        inputmode={props.inputMode}
        maxlength={props.maxlength}
        placeholder={props.saved ? t("vault.placeholder.saved") : props.placeholder}
        value={props.value}
        onValueChange={props.onChange}
      />
      <IconButton
        label={t(shown() ? SECRET_TEXT[props.field].hide : SECRET_TEXT[props.field].show)}
        variant="ghost"
        disabled={revealing()}
        onClick={() => void toggle()}
      >
        <Show when={shown()} fallback={<Eye />}>
          <EyeOff />
        </Show>
      </IconButton>
    </div>
  );
}

/** Add or edit one item in a dialog. */
function ItemDialog(props: {
  kind: VaultItemKind;
  item: VaultItemSummary | null;
  title: string;
  contacts: readonly VaultContactSummary[];
  countries: readonly { code: string; name: string }[];
  contactLine: (contact: VaultContactFields) => string;
  /** The values of a chat request for a new item. */
  prefill?: Readonly<Record<string, string>> | undefined;
  /** A request from the chat: no billing address and no notes, which it does not carry. */
  fromChat?: boolean | undefined;
  /** The server keeps two-step keys, so a login offers one. */
  twoStep?: boolean | undefined;
  /** The agents to choose from. Absent: the item keeps its agents, and a new item is for every agent. */
  agents?: readonly VaultAgentChoice[] | undefined;
  /** The current code of the saved key, from main. */
  savedCode?: LiveTwoStepCode | undefined;
  onCopyCode?: ((code: string) => void) | undefined;
  /** The choice of who can use a requested API key, which the dialog shows in place of the agents. */
  scope?: VaultRequestScope | undefined;
  /** The agent's hint for a requested API key, such as sk-…. */
  keyPlaceholder?: string | undefined;
  /** Saves the item, with the chosen option of `scope` when the dialog has one. */
  onSave: (input: VaultSaveInput, scope?: string) => Promise<void>;
  onReveal: (request: VaultSecretRequest) => Promise<string>;
  onClose: () => void;
}) {
  const { t, errorDetails } = useText();
  const [draft, setDraft] = createSignal<Draft>(
    untrack(() => prefilled(draftOf(props.kind, props.item), props.prefill ?? {})),
  );
  const [saving, setSaving] = createSignal(false);
  const [failure, setFailure] = createSignal<UserErrorDetails | null>(null);
  // A new item is for every agent; the user changes it here or later from its row.
  const [scope, setScope] = createSignal<VaultAgentScope>(untrack(() => props.item?.agents ?? null));
  const [requestScope, setRequestScope] = createSignal(untrack(() => props.scope?.value ?? ""));
  const set = <T extends Draft>(current: T, patch: Partial<T>) => setDraft((): Draft => ({ ...current, ...patch }));
  const loginDraft = () => {
    const current = draft();
    return current.kind === "login" ? current : undefined;
  };
  /** The setup of a two-step key replaces the fields: the key, then a check of its code on the site. */
  const [step, setStep] = createSignal<"form" | "key" | "check">("form");
  const typedKey = createDraftTwoStepCode(() => loginDraft()?.twoStepKey ?? "");
  const savedTwoStep = () => props.item?.kind === "login" && props.item.hasTwoStep;
  const twoStepOn = (login: LoginDraft) => typedKey.valid() || (savedTwoStep() && !login.twoStepRemoved);
  const twoStepCode = () => (typedKey.valid() ? typedKey.code() : props.savedCode);
  const siteName = (login: LoginDraft) =>
    login.website
      .trim()
      .replace(/^https?:\/\//u, "")
      .split("/")[0] || t("vault.twoStep.theSite");
  const keyInvalid = (login: LoginDraft) => login.twoStepKey.trim() !== "" && !typedKey.valid();
  const startSetup = () => {
    const login = loginDraft();
    if (login) set(login, { twoStepKey: "" });
    setStep("key");
  };
  /** Back from the key step drops the typed key, so the login keeps what it had. */
  const cancelSetup = () => {
    const login = loginDraft();
    if (login) set(login, { twoStepKey: "" });
    setStep("form");
  };
  function finishSetup() {
    const login = loginDraft();
    if (login) set(login, { twoStepRemoved: false });
    setStep("form");
  }
  const removeTwoStep = () => {
    const login = loginDraft();
    if (login) set(login, { twoStepKey: "", twoStepRemoved: true });
  };
  const dialogTitle = () => (step() === "form" ? props.title : t("vault.twoStep.setupTitle"));
  const cardDraft = () => {
    const current = draft();
    return current.kind === "card" ? current : undefined;
  };
  const contactDraft = () => {
    const current = draft();
    return current.kind === "contact" ? current : undefined;
  };
  const apiKeyDraft = () => {
    const current = draft();
    return current.kind === "apiKey" ? current : undefined;
  };
  const saved = (field: VaultSecretField) => {
    const item = props.item;
    if (field === "password") return item?.kind === "login" && item.hasPassword;
    if (field === "key") return item?.kind === "apiKey" && item.hasKey;
    return item?.kind === "card";
  };
  const secretProps = (field: VaultSecretField) => ({
    field,
    saved: saved(field),
    onReveal: () => {
      const item = props.item;
      return item ? props.onReveal({ id: item.id, field }) : Promise.resolve("");
    },
    onRevealFailed: (error: unknown) => setFailure(errorDetails(error, t("vault.revealFailed"))),
  });

  async function submit(): Promise<void> {
    if (step() === "key") {
      if (typedKey.valid()) setStep("check");
      return;
    }
    if (step() === "check") {
      finishSetup();
      return;
    }
    if (saving() || !draftReady(draft(), props.item)) return;
    setSaving(true);
    setFailure(null);
    try {
      await props.onSave(
        saveInput(draft(), props.item?.id ?? null, props.agents ? scope() : undefined),
        props.scope ? requestScope() : undefined,
      );
      props.onClose();
    } catch (error) {
      setFailure(errorDetails(error, t("vault.failed")));
    } finally {
      setSaving(false);
    }
  }

  /** The user finds a requested key at the service by its name, so its field has the name as label. */
  const keyLabel = (apiKey: ApiKeyDraft) => (props.fromChat ? apiKey.name : t("vault.field.apiKey"));

  const requestScopeField = () => (
    <Show when={props.scope}>
      {(choice) => (
        <Field label={choice().label} class="vault-wide">
          <NativeSelect value={requestScope()} onChange={(event) => setRequestScope(event.currentTarget.value)}>
            <For each={choice().options}>{(option) => <option value={option}>{option}</option>}</For>
          </NativeSelect>
        </Field>
      )}
    </Show>
  );

  const agentsField = () => (
    <Show when={props.agents}>
      {(agents) => (
        <Field label={t("vault.agents.label")} class="vault-wide">
          <VaultAgentsButton name={props.title} agents={agents()} scope={scope()} onChange={setScope} />
        </Field>
      )}
    </Show>
  );

  const fields = (): JSX.Element => (
    <Switch>
      <Match when={loginDraft()}>
        {(login) => (
          <div class="vault-fields">
            <Field label={t("vault.field.website")} class="vault-wide">
              <Input
                placeholder={t("vault.placeholder.website")}
                maxlength={VAULT_TEXT_LIMIT}
                value={login().website}
                onValueChange={(website) => set(login(), { website })}
              />
            </Field>
            <Field label={t("vault.field.username")} class="vault-wide">
              <Input
                placeholder={t("vault.placeholder.username")}
                autocomplete="off"
                maxlength={VAULT_TEXT_LIMIT}
                value={login().username}
                onValueChange={(username) => set(login(), { username })}
              />
            </Field>
            <Field label={t("vault.field.password")} class="vault-wide">
              <SecretInput
                {...secretProps("password")}
                maxlength={VAULT_PASSWORD_LIMIT}
                value={login().password}
                onChange={(password) => set(login(), { password })}
              />
            </Field>
            <Show when={props.twoStep && !props.fromChat}>
              <TwoStepRow
                on={twoStepOn(login())}
                code={twoStepCode()}
                now={typedKey.now()}
                onSetUp={startSetup}
                onRemove={removeTwoStep}
                onCopy={(code) => props.onCopyCode?.(code)}
              />
            </Show>
            <Show when={!props.fromChat}>
              <Field label={t("vault.field.notes")} class="vault-wide">
                <Textarea
                  rows={2}
                  maxlength={VAULT_NOTES_LIMIT}
                  value={login().notes}
                  onInput={(event) => set(login(), { notes: event.currentTarget.value })}
                />
              </Field>
            </Show>
            {agentsField()}
          </div>
        )}
      </Match>
      <Match when={cardDraft()}>
        {(card) => (
          <div class="vault-fields">
            <Field label={t("vault.field.label")} class="vault-wide">
              <Input
                placeholder={t("vault.placeholder.cardLabel")}
                maxlength={VAULT_TEXT_LIMIT}
                value={card().label}
                onValueChange={(label) => set(card(), { label })}
              />
            </Field>
            <Field label={t("vault.field.nameOnCard")} class="vault-wide">
              <Input
                autocomplete="off"
                maxlength={VAULT_TEXT_LIMIT}
                value={card().nameOnCard}
                onValueChange={(nameOnCard) => set(card(), { nameOnCard })}
              />
            </Field>
            <Field label={t("vault.field.number")} class="vault-wide">
              <SecretInput
                {...secretProps("number")}
                inputMode="numeric"
                maxlength={23}
                placeholder="1234 5678 9012 3456"
                value={card().number}
                onChange={(number) => set(card(), { number })}
              />
            </Field>
            <Field label={t("vault.field.expiry")}>
              <Input
                inputmode="numeric"
                maxlength={7}
                placeholder={t("vault.placeholder.expiry")}
                value={card().expiry}
                onValueChange={(expiry) => set(card(), { expiry })}
              />
            </Field>
            <Field label={t("vault.field.securityCode")}>
              <SecretInput
                {...secretProps("securityCode")}
                inputMode="numeric"
                maxlength={4}
                value={card().securityCode}
                onChange={(securityCode) => set(card(), { securityCode })}
              />
            </Field>
            <Show when={!props.fromChat}>
              <Field label={t("vault.field.billing")} class="vault-wide">
                <NativeSelect
                  value={card().billingContactId}
                  onChange={(event) => set(card(), { billingContactId: event.currentTarget.value })}
                >
                  <option value="">{t("vault.billingNone")}</option>
                  <For each={props.contacts}>
                    {(contact) => (
                      <option value={contact.id}>
                        {[contact.label || contact.fullName, props.contactLine(contact)].filter(Boolean).join(" · ")}
                      </option>
                    )}
                  </For>
                </NativeSelect>
              </Field>
            </Show>
            <Show when={card().fillSites.length > 0}>
              <fieldset class="vault-wide vault-fill-sites">
                <legend class="ui-label">{t("vault.field.fillSites")}</legend>
                <ul class="vault-sites">
                  <For each={card().fillSites}>
                    {(site) => (
                      <li class="vault-site">
                        <span class="vault-truncate">{site}</span>
                        <IconButton
                          label={t("vault.removeSite", { site })}
                          variant="ghost"
                          onClick={() => set(card(), { fillSites: card().fillSites.filter((kept) => kept !== site) })}
                        >
                          <X />
                        </IconButton>
                      </li>
                    )}
                  </For>
                </ul>
              </fieldset>
            </Show>
            {agentsField()}
          </div>
        )}
      </Match>
      <Match when={contactDraft()}>
        {(contact) => (
          <div class="vault-fields">
            <Field label={t("vault.field.label")}>
              <Input
                placeholder={t("vault.placeholder.contactLabel")}
                maxlength={VAULT_TEXT_LIMIT}
                value={contact().label}
                onValueChange={(label) => set(contact(), { label })}
              />
            </Field>
            <Field label={t("vault.field.fullName")}>
              <Input
                maxlength={VAULT_TEXT_LIMIT}
                value={contact().fullName}
                onValueChange={(fullName) => set(contact(), { fullName })}
              />
            </Field>
            <Field label={t("vault.field.address")} class="vault-wide">
              <Input
                maxlength={VAULT_TEXT_LIMIT}
                value={contact().address}
                onValueChange={(address) => set(contact(), { address })}
              />
            </Field>
            <Field label={t("vault.field.address2")} class="vault-wide">
              <Input
                maxlength={VAULT_TEXT_LIMIT}
                value={contact().address2}
                onValueChange={(address2) => set(contact(), { address2 })}
              />
            </Field>
            <Field label={t("vault.field.city")}>
              <Input
                maxlength={VAULT_TEXT_LIMIT}
                value={contact().city}
                onValueChange={(city) => set(contact(), { city })}
              />
            </Field>
            <Field label={t("vault.field.region")}>
              <Input
                maxlength={VAULT_TEXT_LIMIT}
                value={contact().region}
                onValueChange={(region) => set(contact(), { region })}
              />
            </Field>
            <Field label={t("vault.field.postalCode")}>
              <Input
                maxlength={VAULT_TEXT_LIMIT}
                value={contact().postalCode}
                onValueChange={(postalCode) => set(contact(), { postalCode })}
              />
            </Field>
            <Field label={t("vault.field.country")}>
              <NativeSelect
                value={contact().country}
                onChange={(event) => set(contact(), { country: event.currentTarget.value })}
              >
                <option value="">{t("vault.chooseCountry")}</option>
                {/* A country outside the list, such as one that an agent saved, stays a choice under its code. */}
                <Show
                  when={contact().country && !props.countries.some((country) => country.code === contact().country)}
                >
                  <option value={contact().country}>{contact().country}</option>
                </Show>
                <For each={props.countries}>{(country) => <option value={country.code}>{country.name}</option>}</For>
              </NativeSelect>
            </Field>
            <Field label={t("vault.field.phone")}>
              <Input
                type="tel"
                maxlength={VAULT_TEXT_LIMIT}
                value={contact().phone}
                onValueChange={(phone) => set(contact(), { phone })}
              />
            </Field>
            <Field label={t("vault.field.email")}>
              <Input
                type="email"
                maxlength={VAULT_TEXT_LIMIT}
                value={contact().email}
                onValueChange={(email) => set(contact(), { email })}
              />
            </Field>
            {agentsField()}
          </div>
        )}
      </Match>
      <Match when={apiKeyDraft()}>
        {(apiKey) => (
          <div class="vault-fields">
            {/* A request names the key: the agent reads it by this name. */}
            <Show when={!props.fromChat}>
              <Field label={t("vault.field.variableName")} description={t("vault.variableNameHint")} class="vault-wide">
                <Input
                  placeholder={t("vault.placeholder.variableName")}
                  autocomplete="off"
                  spellcheck={false}
                  maxlength={64}
                  value={apiKey().name}
                  onInput={(event) => {
                    // The field shows the capitals that it keeps, so the binding has no other text to restore.
                    const input = event.currentTarget;
                    const { selectionStart, selectionEnd } = input;
                    input.value = input.value.toUpperCase();
                    input.setSelectionRange(selectionStart, selectionEnd);
                    set(apiKey(), { name: input.value });
                  }}
                />
              </Field>
            </Show>
            <Field label={keyLabel(apiKey())} class="vault-wide">
              <SecretInput
                {...secretProps("key")}
                placeholder={props.keyPlaceholder}
                maxlength={VAULT_API_KEY_LIMIT}
                value={apiKey().key}
                onChange={(key) => set(apiKey(), { key })}
              />
            </Field>
            <Show when={!props.fromChat}>
              <Field label={t("vault.field.notes")} class="vault-wide">
                <Textarea
                  rows={2}
                  maxlength={VAULT_NOTES_LIMIT}
                  value={apiKey().notes}
                  onInput={(event) => set(apiKey(), { notes: event.currentTarget.value })}
                />
              </Field>
            </Show>
            {requestScopeField()}
            {agentsField()}
          </div>
        )}
      </Match>
    </Switch>
  );

  return (
    <Dialog.Root open={true} onOpenChange={(open) => !open && !saving() && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay class="ui-confirm-dialog-overlay">
          <Dialog.Content as="section" class="ui-confirm-dialog vault-dialog">
            <form
              class="vault-dialog-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <header class="vault-dialog-header">
                <DraftLogo draft={draft()} saved={props.item} />
                <Dialog.Title as="h2" class="vault-dialog-title">
                  {dialogTitle()}
                </Dialog.Title>
                <IconButton label={t("common.close")} variant="ghost" disabled={saving()} onClick={props.onClose}>
                  <X />
                </IconButton>
              </header>
              <div class="vault-dialog-body">
                <Switch fallback={fields()}>
                  <Match when={step() === "key" && loginDraft()}>
                    {(login) => (
                      <TwoStepKeyStep
                        site={siteName(login())}
                        keyText={login().twoStepKey}
                        invalid={keyInvalid(login())}
                        onChange={(twoStepKey) => set(login(), { twoStepKey })}
                      />
                    )}
                  </Match>
                  <Match when={step() === "check" && loginDraft()}>
                    {(login) => (
                      <TwoStepCheckStep site={siteName(login())} code={typedKey.code()} now={typedKey.now()} />
                    )}
                  </Match>
                </Switch>
                <Show when={failure()}>
                  {(current) => (
                    <Text tone="danger" variant="caption" role="alert">
                      <FailureText failure={current()} />
                    </Text>
                  )}
                </Show>
              </div>
              <footer class="ui-confirm-dialog-actions">
                <Switch
                  fallback={
                    <>
                      <Button type="button" variant="ghost" disabled={saving()} onClick={props.onClose}>
                        {t("common.cancel")}
                      </Button>
                      <Button
                        type="submit"
                        loading={saving()}
                        loadingLabel={t("common.saving")}
                        disabled={!draftReady(draft(), props.item)}
                      >
                        {t("common.save")}
                      </Button>
                    </>
                  }
                >
                  <Match when={step() === "key"}>
                    <Button type="button" variant="ghost" onClick={cancelSetup}>
                      {t("common.back")}
                    </Button>
                    <Button type="submit" disabled={!typedKey.valid()}>
                      {t("common.continue")}
                    </Button>
                  </Match>
                  <Match when={step() === "check"}>
                    <Button type="button" variant="ghost" onClick={() => setStep("key")}>
                      {t("common.back")}
                    </Button>
                    <Button type="submit">{t("common.done")}</Button>
                  </Match>
                </Switch>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Who can use a requested item, as the host gives the choice: its label, its options, and the first value. */
export interface VaultRequestScope {
  label: string;
  options: readonly string[];
  value: string;
}

/**
 * The Vault dialog for a request from the chat: a new login, card, contact or API key, with the values
 * that the agent filled in. It has no billing address and no notes, which a request does not carry.
 */
export function VaultRequestDialog(props: {
  kind: VaultItemKind;
  title: string;
  prefill: Readonly<Record<string, string>>;
  /** Only for an API key: who can use it. */
  scope?: VaultRequestScope | undefined;
  /** Only for an API key: the agent's hint for the key, such as sk-…. */
  keyPlaceholder?: string | undefined;
  /** Saves the item. A failure stays in the dialog, so the user can correct a value. */
  onSave: (input: VaultSaveInput, scope?: string) => Promise<void>;
  onClose: () => void;
}) {
  const { countries } = useCountries();
  return (
    <ItemDialog
      kind={props.kind}
      item={null}
      title={props.title}
      contacts={[]}
      countries={countries()}
      contactLine={() => ""}
      prefill={props.prefill}
      fromChat
      scope={props.scope}
      keyPlaceholder={props.keyPlaceholder}
      onSave={props.onSave}
      onReveal={() => Promise.resolve("")}
      onClose={props.onClose}
    />
  );
}

export {
  BRAND_NAME as VAULT_BRAND_NAME,
  CardLogo as VaultCardLogo,
  ContactLogo as VaultContactLogo,
  SiteLogo as VaultSiteLogo,
};
