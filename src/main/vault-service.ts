// The Vault of this computer: logins, payment cards, contact info and API keys that the user saves in
// Server settings. Agents fill logins through the `PasswordVault` port (`openbot:` IDs) and cards and
// contact info through `VaultItems`; neither port gives an agent a password, a two-step key, a card
// number or a security code. `PasswordVault` enters a login's two-step code; the key stays here. Agents
// can also add and change items through `VaultItems`, and save a password, a two-step key or an API key
// that they have, but never read one back or set a card number. API keys reach an agent only as files
// that `AgentApiKeys` writes. Each item is for every agent, or for the agents that the user chose: an
// agent lists, fills, changes and reads only the items that it can use.

import { randomUUID } from "node:crypto";
import {
  cardBrand,
  VAULT_FILL_SITE_LIMIT,
  VAULT_NOTES_LIMIT,
  VAULT_PASSWORD_LIMIT,
  VAULT_TEXT_LIMIT,
  type VaultContactFields,
  type VaultImportResult,
  type VaultItemScope,
  type VaultItemSummary,
  type VaultSaveInput,
  type VaultSaveScope,
  type VaultSecretRequest,
  type VaultState,
  type VaultStatus,
  type VaultTwoStepCode,
  vaultItemAllows,
} from "@openbot/contracts/ipc";
import {
  normalizeTwoStepKey,
  parseTwoStepKey,
  type TwoStepKey,
  twoStepCode,
  twoStepKeySecret,
  twoStepRemainingMs,
} from "@openbot/contracts/two-step-code";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import { registerSecretValues } from "@openbot/logging";
import { Effect } from "effect";
import { type PasswordVault, PasswordVaultError, websiteMatchesOrigin, websiteUrl } from "../backend/password-vault";
import type {
  VaultAgent,
  VaultAgentApiKey,
  VaultAgentChange,
  VaultAgentResult,
  VaultCardSecret,
  VaultEnteredItem,
  VaultItems,
  VaultTypedLogin,
} from "../backend/vault-items";
import { parseLoginCsv } from "./vault-csv";
import { decodeVaultSaveInput, vaultWebsite } from "./vault-inputs";
import type { StoredApiKey, StoredCard, StoredContact, StoredLogin, VaultRecord, VaultStore } from "./vault-store";

type VaultErrorKey = Extract<keyof SourceMessages, `error.vault.${string}`>;

function vaultError(key: VaultErrorKey): PasswordVaultError {
  return new PasswordVaultError({ cause: new Error(sourceText(key)) });
}

/** For a change function: the store turns the thrown error into a `PasswordVaultError`. */
function refuse(key: VaultErrorKey): never {
  throw new Error(sourceText(key));
}

/**
 * Registers every secret of `record` for log redaction, in one pattern rebuild. A card number is
 * also redacted as the page may show it, in groups of four. The security code is not registered:
 * a three-digit pattern would remove numbers from every log line. It reaches only the page. A two-step
 * key is also redacted as sites show it: in lower case, and in groups of four.
 */
function registerSecrets(record: VaultRecord): void {
  registerSecretValues(
    record.logins.map((login) => login.password),
    { allowShort: true },
  );
  registerSecretValues(
    record.logins.flatMap(({ twoStepKey }) => {
      const secret = twoStepKey ? twoStepKeySecret(twoStepKey) : null;
      if (!twoStepKey || !secret) return [];
      const grouped = secret.replace(/(.{4})(?=.)/gu, "$1 ");
      return [twoStepKey, secret, secret.toLowerCase(), grouped, grouped.toLowerCase()];
    }),
  );
  registerSecretValues(
    record.cards.flatMap(({ number }) => [
      number,
      number.replace(/(\d{4})(?=\d)/gu, "$1 "),
      number.replace(/(\d{4})(?=\d)/gu, "$1-"),
    ]),
  );
  registerSecretValues(
    record.apiKeys.map(({ key }) => key),
    { allowShort: true },
  );
}

/** The code of a saved key. The key was checked when it was saved, so a failure is a platform fault. */
function makeCode(key: TwoStepKey, at: number): Effect.Effect<string, PasswordVaultError> {
  return Effect.tryPromise({ try: () => twoStepCode(key, at), catch: (cause) => new PasswordVaultError({ cause }) });
}

function loginTitle(website: string): string {
  return websiteUrl(website)?.hostname ?? website;
}

/** The host and port of a saved website. `www.example.com` is the same host as `example.com`. */
function loginHost(website: string): string | undefined {
  return websiteUrl(website)?.host.replace(/^www\./u, "");
}

/** The agent that added an item, kept when the user or another agent changes it. */
function origin(existing: { addedBy?: string } | undefined, addedBy: string | undefined): { addedBy?: string } {
  const name = existing ? existing.addedBy : addedBy;
  return name === undefined ? {} : { addedBy: name };
}

/** The agents of an item after a save: `input` names them, or the saved item keeps its own. */
function scope(
  existing: { readonly agents?: readonly string[] } | undefined,
  input: VaultSaveScope,
): { agents?: string[] } {
  const agents = input.agents === undefined ? existing?.agents : (input.agents ?? undefined);
  return agents === undefined ? {} : { agents: [...agents] };
}

/** The agents of a stored item, for a list that the settings page reads. */
function listedScope(item: { readonly agents?: readonly string[] }): VaultItemScope {
  return item.agents === undefined ? {} : { agents: [...item.agents] };
}

/** Whether `agents` names exactly `agentId`: the item is that agent's own. */
function onlyFor(item: { readonly agents?: readonly string[] }, agentId: string): boolean {
  return item.agents?.length === 1 && item.agents[0] === agentId;
}

/** Two API keys of one name that one agent would read: both for every agent, or a shared chosen agent. */
function sameReader(a: VaultItemScope, b: { readonly agents?: readonly string[] }): boolean {
  if (a.agents === undefined || b.agents === undefined) return a.agents === undefined && b.agents === undefined;
  return a.agents.some((agent) => b.agents?.includes(agent));
}

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

/** `saved` with each field that `given` has over it. */
function mergeContact(
  saved: VaultContactFields,
  given: Extract<VaultAgentChange, { kind: "contact" }>["fields"],
): VaultContactFields {
  return {
    label: given.label ?? saved.label,
    fullName: given.fullName ?? saved.fullName,
    address: given.address ?? saved.address,
    address2: given.address2 ?? saved.address2,
    city: given.city ?? saved.city,
    region: given.region ?? saved.region,
    postalCode: given.postalCode ?? saved.postalCode,
    country: given.country ?? saved.country,
    phone: given.phone ?? saved.phone,
    email: given.email ?? saved.email,
  };
}

/** The name that the user knows an item by. It holds no secret: a card shows its last four digits only. */
function itemName(record: VaultRecord, id: string): VaultAgentResult | null {
  const login = record.logins.find((item) => item.id === id);
  if (login) return { id, kind: "login", name: loginTitle(login.website) };
  const card = record.cards.find((item) => item.id === id);
  if (card) return { id, kind: "card", name: card.label || `•••• ${card.number.slice(-4)}` };
  const contact = record.contacts.find((item) => item.id === id);
  if (contact)
    return { id, kind: "contact", name: contact.label || contact.fullName || contact.email || contact.address };
  const apiKey = record.apiKeys.find((item) => item.id === id);
  if (apiKey) return { id, kind: "apiKey", name: apiKey.name };
  return null;
}

/**
 * The settings-page input for an agent's change: the saved values, with the fields the agent gave
 * over them. Secrets stay null, so the saved ones are kept. The same decoder then checks it.
 */
function agentSaveInput(record: VaultRecord, change: VaultAgentChange): VaultSaveInput {
  const find = <T extends { id: string }>(items: readonly T[], id: string): T =>
    items.find((item) => item.id === id) ?? refuse("error.vault.itemMissing");
  switch (change.kind) {
    case "contact": {
      const existing = change.id === undefined ? undefined : find(record.contacts, change.id);
      const fields = mergeContact(existing ?? EMPTY_CONTACT, change.fields);
      return decodeVaultSaveInput({ kind: "contact", id: existing?.id ?? null, ...fields });
    }
    case "login": {
      const existing = find(record.logins, change.id);
      return decodeVaultSaveInput({
        kind: "login",
        id: existing.id,
        website: existing.website,
        username: change.username ?? existing.username,
        notes: existing.notes,
        password: change.password ?? null,
        twoStepKey: change.twoStepKey,
      });
    }
    case "card": {
      const existing = find(record.cards, change.id);
      return decodeVaultSaveInput({
        kind: "card",
        id: existing.id,
        label: change.label ?? existing.label,
        nameOnCard: change.nameOnCard ?? existing.nameOnCard,
        expMonth: change.expMonth ?? existing.expMonth,
        expYear: change.expYear ?? existing.expYear,
        billingContactId: change.billingContactId === undefined ? existing.billingContactId : change.billingContactId,
        number: null,
        securityCode: null,
      });
    }
  }
}

function summary(record: VaultRecord): VaultItemSummary[] {
  return [
    ...record.logins.map(
      (login): VaultItemSummary => ({
        id: login.id,
        ...origin(login, undefined),
        ...listedScope(login),
        kind: "login",
        website: login.website,
        username: login.username,
        notes: login.notes,
        hasPassword: login.password.length > 0,
        hasTwoStep: Boolean(login.twoStepKey),
      }),
    ),
    ...record.cards.map(
      (card): VaultItemSummary => ({
        id: card.id,
        ...origin(card, undefined),
        ...listedScope(card),
        kind: "card",
        label: card.label,
        nameOnCard: card.nameOnCard,
        brand: cardBrand(card.number),
        last4: card.number.slice(-4),
        expMonth: card.expMonth,
        expYear: card.expYear,
        billingContactId: card.billingContactId,
        fillSites: (card.fillSites ?? []).map(({ page }) => page),
      }),
    ),
    ...record.contacts.map((item): VaultItemSummary => {
      const { agents: _agents, ...contact } = item;
      return { ...contact, ...listedScope(item), kind: "contact" };
    }),
    ...record.apiKeys.map(
      (apiKey): VaultItemSummary => ({
        id: apiKey.id,
        ...origin(apiKey, undefined),
        ...listedScope(apiKey),
        kind: "apiKey",
        name: apiKey.name,
        notes: apiKey.notes,
        hasKey: apiKey.key.length > 0,
      }),
    ),
  ];
}

function replaceOrAdd<T extends { id: string }>(items: readonly T[], item: T): T[] {
  return items.some(({ id }) => id === item.id)
    ? items.map((current) => (current.id === item.id ? item : current))
    : [...items, item];
}

/** The CSV file that `importCsv` reads, in bytes. A password export of thousands of logins fits. */
export const VAULT_CSV_LIMIT = 4 * 1024 * 1024;

export interface VaultServiceOptions {
  store: VaultStore;
  /** False on Linux without a keyring: nothing can be encrypted, so nothing is saved. */
  canPersist: () => boolean;
}

export class VaultService {
  readonly #store: VaultStore;
  readonly #canPersist: () => boolean;
  #status: VaultStatus = "ready";
  readonly #listeners = new Set<(state: VaultState) => void>();

  constructor(options: VaultServiceOptions) {
    this.#store = options.store;
    this.#canPersist = options.canPersist;
  }

  readonly load = Effect.fn("VaultService.load")(function* (this: VaultService) {
    if (!this.#canPersist()) {
      this.#status = "unavailable";
      return;
    }
    const readable = yield* this.#store.load();
    this.#status = readable ? "ready" : "unreadable";
    registerSecrets(this.#store.read());
  });

  state(): VaultState {
    return {
      status: this.#status,
      items: this.#status === "ready" ? summary(this.#store.read()) : [],
      agentScope: true,
    };
  }

  onChanged(listener: (state: VaultState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  readonly save = Effect.fn("VaultService.save")(function* (this: VaultService, input: VaultSaveInput) {
    yield* this.#change((record) => this.#put(record, input, undefined).record);
    return this.state();
  });

  readonly delete = Effect.fn("VaultService.delete")(function* (this: VaultService, id: string) {
    yield* this.#change((record) =>
      itemName(record, id) ? this.#without(record, id) : refuse("error.vault.itemMissing"),
    );
    return this.state();
  });

  /** A saved password, card number, security code or API key, for the user who asked to see or copy it. */
  reveal({ id, field }: VaultSecretRequest): string {
    this.#requireReady();
    const record = this.#store.read();
    switch (field) {
      case "password": {
        const login = record.logins.find((item) => item.id === id);
        if (login) return login.password;
        break;
      }
      case "number":
      case "securityCode": {
        const card = record.cards.find((item) => item.id === id);
        if (card) return field === "number" ? card.number : card.securityCode;
        break;
      }
      case "key": {
        const apiKey = record.apiKeys.find((item) => item.id === id);
        if (apiKey) return apiKey.key;
        break;
      }
    }
    return refuse("error.vault.itemMissing");
  }

  /**
   * Adds the logins of a CSV export. A row is skipped when its website is not HTTPS, it has no
   * password, or the same login is already saved. A row of a saved login adds only its two-step key,
   * when the saved login has none.
   */
  readonly importCsv = Effect.fn("VaultService.importCsv")(function* (this: VaultService, source: string) {
    const parsed = yield* Effect.try({
      try: () => parseLoginCsv(source),
      catch: (cause) => new PasswordVaultError({ cause }),
    });
    let imported = 0;
    let skipped = parsed.otherRows;
    yield* this.#change((record) => {
      const logins = [...record.logins];
      imported = 0;
      skipped = parsed.otherRows;
      for (const row of parsed.logins) {
        const website = vaultWebsite(row.website);
        const valid =
          website !== null &&
          row.password.trim().length > 0 &&
          website.length <= VAULT_TEXT_LIMIT &&
          row.username.length <= VAULT_TEXT_LIMIT &&
          row.password.length <= VAULT_PASSWORD_LIMIT;
        if (!valid) {
          skipped += 1;
          continue;
        }
        // A two-step key that is not a TOTP key is left out; the login is still imported.
        const twoStepKey = row.twoStepKey ? normalizeTwoStepKey(row.twoStepKey) : null;
        const duplicate = logins.findIndex(
          (login) =>
            loginTitle(login.website) === loginTitle(website) &&
            login.username === row.username &&
            login.password === row.password,
        );
        if (duplicate >= 0) {
          // An export imported again adds the two-step key to a saved login that has none.
          const saved = logins[duplicate];
          if (saved && twoStepKey && !saved.twoStepKey) {
            logins[duplicate] = { ...saved, twoStepKey };
            imported += 1;
          } else {
            skipped += 1;
          }
          continue;
        }
        logins.push({
          id: randomUUID(),
          website,
          username: row.username,
          password: row.password,
          notes: row.notes.slice(0, VAULT_NOTES_LIMIT),
          ...(twoStepKey ? { twoStepKey } : {}),
        });
        imported += 1;
      }
      return imported > 0 ? { ...record, logins } : record;
    });
    const result: VaultImportResult = { imported, skipped, state: this.state() };
    return result;
  });

  /** Removes the Vault file and every item. The only way out of `unreadable`. */
  readonly reset = Effect.fn("VaultService.reset")(function* (this: VaultService) {
    if (!this.#canPersist()) {
      this.#status = "unavailable";
      return this.state();
    }
    yield* this.#store.clear();
    this.#status = "ready";
    this.#emit();
    return this.state();
  });

  /** The current two-step code of each login that has a key, for the Vault page. */
  readonly codes = Effect.fn("VaultService.codes")(function* (this: VaultService) {
    if (this.#status !== "ready") return { codes: [] };
    const at = Date.now();
    const codes: VaultTwoStepCode[] = [];
    for (const login of this.#store.read().logins) {
      const key = login.twoStepKey ? parseTwoStepKey(login.twoStepKey) : null;
      if (!key) continue;
      const code = yield* makeCode(key, at);
      codes.push({ id: login.id, code, period: key.period, remainingMs: twoStepRemainingMs(key.period, at) });
    }
    return { codes };
  });

  /** The built-in logins, for the password vault router under the `openbot:` prefix. */
  readonly logins: PasswordVault = {
    connected: () => this.#status === "ready" && this.#store.read().logins.length > 0,
    loginsFor: (origin, agentId) =>
      Effect.sync(() => {
        if (this.#status !== "ready") return null;
        return this.#store
          .read()
          .logins.filter(
            (login) =>
              this.#allows(login, agentId) &&
              websiteMatchesOrigin({ url: login.website, autofill: "anywhere" }, origin),
          )
          .map((login) => ({
            id: login.id,
            title: loginTitle(login.website),
            username: login.username || null,
            hasOneTimePassword: Boolean(login.twoStepKey),
          }));
      }),
    secretFor: (loginId, origin, kind, agentId) =>
      Effect.suspend(() => {
        if (this.#status !== "ready") return Effect.succeed(null);
        const login = this.#store.read().logins.find((item) => item.id === loginId);
        if (
          !login ||
          !this.#allows(login, agentId) ||
          !websiteMatchesOrigin({ url: login.website, autofill: "anywhere" }, origin)
        )
          return Effect.succeed(null);
        if (kind === "password") return Effect.succeed(login.password || null);
        const key = login.twoStepKey ? parseTwoStepKey(login.twoStepKey) : null;
        return key ? makeCode(key, Date.now()) : Effect.succeed(null);
      }),
  };

  readonly #agentSave = Effect.fn("VaultService.agentSave")(function* (
    this: VaultService,
    change: VaultAgentChange,
    agent: VaultAgent,
  ) {
    // The change runs inside the store's write, so the result is kept here.
    const outcome: { saved: (VaultAgentResult & { created: boolean }) | null } = { saved: null };
    yield* this.#change((record) => {
      const input = agentSaveInput(this.#forAgent(record, agent.id), change);
      const next = this.#put(record, input, agent.name);
      const named = itemName(next.record, next.id);
      outcome.saved = named && { ...named, created: input.id === null };
      return next.record;
    });
    return outcome.saved ?? (yield* vaultError("error.vault.itemMissing"));
  });

  readonly #agentDelete = Effect.fn("VaultService.agentDelete")(function* (
    this: VaultService,
    id: string,
    agentId: string,
  ) {
    const outcome: { deleted: VaultAgentResult | null } = { deleted: null };
    yield* this.#change((record) => {
      // An agent does not see API keys as items, so it cannot delete one.
      const named = itemName(this.#forAgent(record, agentId), id);
      outcome.deleted = named?.kind === "apiKey" ? null : named;
      return outcome.deleted ? this.#without(record, id) : record;
    });
    return outcome.deleted;
  });

  /** Lets agents fill `cardId` on `page` into fields in `frames`, next to what the owner approved before. */
  readonly #approveCardFill = Effect.fn("VaultService.approveCardFill")(function* (
    this: VaultService,
    cardId: string,
    page: string,
    frames: readonly string[],
  ) {
    yield* this.#change((record) => {
      const card = this.#find(record.cards, cardId);
      const sites = card.fillSites ?? [];
      const known = sites.find((entry) => entry.page === page)?.frames ?? [];
      const site = { page, frames: [...new Set([...known, ...frames])] };
      // The newest approval goes last, so the limit drops the oldest one.
      const fillSites = [...sites.filter((entry) => entry.page !== page), site].slice(-VAULT_FILL_SITE_LIMIT);
      return { ...record, cards: replaceOrAdd(record.cards, { ...card, fillSites }) };
    });
  });

  readonly #saveTypedLogin = Effect.fn("VaultService.saveTypedLogin")(function* (
    this: VaultService,
    login: VaultTypedLogin,
    agent: VaultAgent,
  ) {
    const website = vaultWebsite(login.origin);
    if (!website || login.username.length > VAULT_TEXT_LIMIT) return yield* vaultError("error.vault.websiteInvalid");
    if (!login.password.trim() || login.password.length > VAULT_PASSWORD_LIMIT)
      return yield* vaultError("error.vault.passwordRequired");
    const username = login.username.trim();
    const outcome: { saved: (VaultAgentResult & { created: boolean; changed: boolean }) | null } = { saved: null };
    yield* this.#change((record) => {
      const matches = (item: StoredLogin) =>
        item.username === username && websiteMatchesOrigin({ url: item.website, autofill: "anywhere" }, website);
      const usable = record.logins.filter((item) => vaultItemAllows(item, agent.id) && matches(item));
      // Only a login for this host gets the new password. A login for another host of the site, such as
      // status.example.com for billing.example.com, can be another account: it stays, and this login
      // is added. When that login has this password, it already fills here, and nothing is added.
      const existing =
        usable.find((item) => loginHost(item.website) === loginHost(website)) ??
        usable.find((item) => item.password === login.password);
      // The user keeps this login from this agent, so the agent's copy is for this agent only.
      const hidden = !existing && record.logins.some((item) => !vaultItemAllows(item, agent.id) && matches(item));
      if (existing?.password === login.password) {
        outcome.saved = {
          id: existing.id,
          kind: "login",
          name: loginTitle(existing.website),
          created: false,
          changed: false,
        };
        return record;
      }
      // The host alone, as the user types a website in the Vault page.
      const host = websiteUrl(website)?.host ?? website;
      const stored: StoredLogin = existing
        ? { ...existing, password: login.password }
        : {
            id: randomUUID(),
            website: host,
            username,
            password: login.password,
            notes: "",
            ...origin(undefined, agent.name),
            ...(hidden ? { agents: [agent.id] } : {}),
          };
      outcome.saved = {
        id: stored.id,
        kind: "login",
        name: loginTitle(stored.website),
        created: !existing,
        changed: true,
      };
      return { ...record, logins: replaceOrAdd(record.logins, stored) };
    });
    return outcome.saved ?? (yield* vaultError("error.vault.itemMissing"));
  });

  readonly #saveApiKey = Effect.fn("VaultService.saveApiKey")(function* (
    this: VaultService,
    apiKey: VaultAgentApiKey,
    agent: VaultAgent,
    only: boolean,
  ) {
    const outcome: { saved: (VaultAgentResult & { created: boolean }) | null } = { saved: null };
    yield* this.#change((record) => {
      const named = record.apiKeys.filter((item) => item.name === apiKey.name);
      const existing = named.find((item) => (only ? onlyFor(item, agent.id) : item.agents === undefined));
      // The agent stops reading every other key of this name for chosen agents, so it reads the new key.
      // A key that no agent then reads is deleted.
      const apiKeys = record.apiKeys.flatMap((item): StoredApiKey[] => {
        if (item.name !== apiKey.name || item === existing || !item.agents?.includes(agent.id)) return [item];
        const agents = item.agents.filter((id) => id !== agent.id);
        return agents.length > 0 ? [{ ...item, agents }] : [];
      });
      const next = this.#put(
        { ...record, apiKeys },
        decodeVaultSaveInput({
          kind: "apiKey",
          id: existing?.id ?? null,
          name: apiKey.name,
          notes: apiKey.notes ?? existing?.notes ?? "",
          key: apiKey.key,
          agents: only ? [agent.id] : null,
        }),
        agent.name,
      );
      const saved = itemName(next.record, next.id);
      outcome.saved = saved && { ...saved, created: !existing };
      return next.record;
    });
    return outcome.saved ?? (yield* vaultError("error.vault.itemMissing"));
  });

  readonly #removeAgentApiKey = Effect.fn("VaultService.removeAgentApiKey")(function* (
    this: VaultService,
    agentId: string,
    name: string,
  ) {
    const outcome = { removed: false };
    yield* this.#change((record) => {
      const own = record.apiKeys.find((item) => item.name === name && onlyFor(item, agentId));
      outcome.removed = own !== undefined;
      return own ? this.#without(record, own.id) : record;
    });
    return outcome.removed;
  });

  readonly #addEntered = Effect.fn("VaultService.addEntered")(function* (
    this: VaultService,
    item: VaultEnteredItem,
    agent: VaultAgent,
  ) {
    const outcome: { saved: VaultAgentResult | null } = { saved: null };
    yield* this.#change((record) => {
      // The same checks as the Vault page: an HTTPS website, a card number that passes the Luhn check.
      // A new item is for every agent; the user can choose its agents in the Vault page.
      const next = this.#put(record, { ...decodeVaultSaveInput(item), agents: null }, agent.name);
      outcome.saved = itemName(next.record, next.id);
      return next.record;
    });
    return outcome.saved ?? (yield* vaultError("error.vault.itemMissing"));
  });

  /** The cards and contact info, for the browser tools, and the API keys, for `AgentApiKeys`. */
  readonly items: VaultItems = {
    ready: () => this.#status === "ready",
    apiKeys: (agentId) => {
      if (this.#status !== "ready") return [];
      const keys = new Map<string, { value: string; own: boolean }>();
      const { apiKeys } = this.#store.read();
      for (const item of apiKeys) if (item.agents === undefined) keys.set(item.name, { value: item.key, own: false });
      // A key for chosen agents wins over the key for every agent of its name.
      for (const item of apiKeys)
        if (item.agents?.includes(agentId)) keys.set(item.name, { value: item.key, own: onlyFor(item, agentId) });
      return [...keys].map(([name, { value, own }]) => ({ name, value, own }));
    },
    sharedApiKeys: () =>
      this.#status === "ready"
        ? this.#store
            .read()
            .apiKeys.filter((item) => item.agents === undefined)
            .map((item) => ({ name: item.name, value: item.key }))
        : [],
    hasCards: (agentId) =>
      this.#status === "ready" && this.#store.read().cards.some((item) => vaultItemAllows(item, agentId)),
    hasContacts: (agentId) =>
      this.#status === "ready" && this.#store.read().contacts.some((item) => vaultItemAllows(item, agentId)),
    listForAgent: (agentId) => {
      if (this.#status !== "ready") return { logins: [], cards: [], contacts: [] };
      const record = this.#forAgent(this.#store.read(), agentId);
      return {
        logins: record.logins.map((login) => ({
          id: login.id,
          website: login.website,
          username: login.username,
          hasTwoStepKey: Boolean(login.twoStepKey),
          ...origin(login, undefined),
        })),
        cards: record.cards.map((card) => ({
          id: card.id,
          label: card.label,
          nameOnCard: card.nameOnCard,
          brand: cardBrand(card.number),
          last4: card.number.slice(-4),
          expiry: `${String(card.expMonth).padStart(2, "0")}/${card.expYear}`,
          hasSecurityCode: card.securityCode !== "",
          billingContactId: card.billingContactId,
          ...origin(card, undefined),
        })),
        contacts: record.contacts.map(({ agents: _agents, ...contact }) => ({ ...contact })),
      };
    },
    cardSecret: (cardId, agentId): VaultCardSecret | null => {
      if (this.#status !== "ready") return null;
      const card = this.#forAgent(this.#store.read(), agentId).cards.find((item) => item.id === cardId);
      return card
        ? {
            number: card.number,
            securityCode: card.securityCode,
            expMonth: card.expMonth,
            expYear: card.expYear,
            nameOnCard: card.nameOnCard,
          }
        : null;
    },
    cardFillApproved: (cardId, page, frames) => {
      if (this.#status !== "ready") return false;
      const site = this.#store
        .read()
        .cards.find((item) => item.id === cardId)
        ?.fillSites?.find((entry) => entry.page === page);
      return site !== undefined && frames.every((frame) => site.frames.includes(frame));
    },
    approveCardFill: (cardId, page, frames) => this.#approveCardFill(cardId, page, frames),
    save: (change, agent) => this.#agentSave(change, agent),
    delete: (id, agentId) => this.#agentDelete(id, agentId),
    saveLogin: (login, agent) => this.#saveTypedLogin(login, agent),
    saveApiKey: (apiKey, agent, only) => this.#saveApiKey(apiKey, agent, only),
    removeAgentApiKey: (agentId, name) => this.#removeAgentApiKey(agentId, name),
    addEntered: (item, agent) => this.#addEntered(item, agent),
  };

  /** Whether `agentId` can use `item`. Without an agent, only the items for every agent. */
  #allows(item: { readonly agents?: readonly string[] }, agentId: string | undefined): boolean {
    return agentId === undefined ? item.agents === undefined : vaultItemAllows(item, agentId);
  }

  /** The items of `record` that `agentId` can use. */
  #forAgent(record: VaultRecord, agentId: string): VaultRecord {
    const allowed = <T extends { readonly agents?: readonly string[] }>(items: readonly T[]) =>
      items.filter((item) => vaultItemAllows(item, agentId));
    return {
      logins: allowed(record.logins),
      cards: allowed(record.cards),
      contacts: allowed(record.contacts),
      apiKeys: allowed(record.apiKeys),
    };
  }

  /** `record` with `input` added or changed, and the id of that item. */
  #put(record: VaultRecord, input: VaultSaveInput, addedBy: string | undefined): { record: VaultRecord; id: string } {
    switch (input.kind) {
      case "login": {
        const login = this.#login(record, input, addedBy);
        return { record: { ...record, logins: replaceOrAdd(record.logins, login) }, id: login.id };
      }
      case "card": {
        const card = this.#card(record, input, addedBy);
        return { record: { ...record, cards: replaceOrAdd(record.cards, card) }, id: card.id };
      }
      case "contact": {
        const { kind: _kind, id, agents, ...fields } = input;
        const existing = id === null ? undefined : this.#find(record.contacts, id);
        const contact: StoredContact = {
          ...fields,
          id: existing?.id ?? randomUUID(),
          ...origin(existing, addedBy),
          ...scope(existing, { agents }),
        };
        return { record: { ...record, contacts: replaceOrAdd(record.contacts, contact) }, id: contact.id };
      }
      case "apiKey": {
        const apiKey = this.#apiKey(record, input, addedBy);
        return { record: { ...record, apiKeys: replaceOrAdd(record.apiKeys, apiKey) }, id: apiKey.id };
      }
    }
  }

  #without(record: VaultRecord, id: string): VaultRecord {
    return {
      logins: record.logins.filter((login) => login.id !== id),
      // A card that names the removed contact as its billing address keeps no reference to it.
      cards: record.cards
        .filter((card) => card.id !== id)
        .map((card) => (card.billingContactId === id ? { ...card, billingContactId: null } : card)),
      contacts: record.contacts.filter((contact) => contact.id !== id),
      apiKeys: record.apiKeys.filter((apiKey) => apiKey.id !== id),
    };
  }

  #login(
    record: VaultRecord,
    input: Extract<VaultSaveInput, { kind: "login" }>,
    addedBy: string | undefined,
  ): StoredLogin {
    const existing = input.id === null ? undefined : this.#find(record.logins, input.id);
    const password = input.password ?? existing?.password;
    if (!password) return refuse("error.vault.passwordRequired");
    // Omitted keeps the saved key, and "" removes it.
    const twoStepKey = input.twoStepKey === undefined ? existing?.twoStepKey : input.twoStepKey;
    return {
      id: existing?.id ?? randomUUID(),
      website: input.website,
      username: input.username,
      notes: input.notes,
      password,
      ...(twoStepKey ? { twoStepKey } : {}),
      ...origin(existing, addedBy),
      ...scope(existing, input),
    };
  }

  #card(
    record: VaultRecord,
    input: Extract<VaultSaveInput, { kind: "card" }>,
    addedBy: string | undefined,
  ): StoredCard {
    const existing = input.id === null ? undefined : this.#find(record.cards, input.id);
    const number = input.number ?? existing?.number;
    if (!number) return refuse("error.vault.cardNumberInvalid");
    if (input.billingContactId !== null && !record.contacts.some(({ id }) => id === input.billingContactId))
      return refuse("error.vault.contactMissing");
    // The page can only remove an approved site. A new one comes from the owner's approval card.
    const kept = input.fillSites;
    const fillSites = (existing?.fillSites ?? []).filter(({ page }) => kept === undefined || kept.includes(page));
    return {
      id: existing?.id ?? randomUUID(),
      label: input.label,
      nameOnCard: input.nameOnCard,
      number,
      expMonth: input.expMonth,
      expYear: input.expYear,
      securityCode: input.securityCode ?? existing?.securityCode ?? "",
      billingContactId: input.billingContactId,
      ...(fillSites.length > 0 ? { fillSites } : {}),
      ...origin(existing, addedBy),
      ...scope(existing, input),
    };
  }

  /**
   * An agent reads a key by its name, so one name gives each agent one key: one key for every agent,
   * and keys for chosen agents that share no agent. A key for chosen agents wins over the key for every
   * agent.
   */
  #apiKey(
    record: VaultRecord,
    input: Extract<VaultSaveInput, { kind: "apiKey" }>,
    addedBy: string | undefined,
  ): StoredApiKey {
    const existing = input.id === null ? undefined : this.#find(record.apiKeys, input.id);
    const key = input.key ?? existing?.key;
    if (!key) return refuse("error.vault.apiKeyRequired");
    const agents = scope(existing, input);
    const other = record.apiKeys.find(
      (item) => item.name === input.name && item.id !== existing?.id && sameReader(agents, item),
    );
    if (other)
      return refuse(agents.agents === undefined ? "error.vault.apiKeyNameTaken" : "error.vault.apiKeyAgentTaken");
    return {
      id: existing?.id ?? randomUUID(),
      name: input.name,
      key,
      notes: input.notes,
      ...origin(existing, addedBy),
      ...agents,
    };
  }

  /** An edit of an item that another window removed fails, so it does not come back as a new item. */
  #find<T extends { id: string }>(items: readonly T[], id: string): T {
    const item = items.find((current) => current.id === id);
    return item ?? refuse("error.vault.itemMissing");
  }

  #requireReady(): void {
    if (this.#status === "unavailable") refuse("error.vault.unavailable");
    if (this.#status === "unreadable") refuse("error.vault.unreadable");
  }

  readonly #change = Effect.fn("VaultService.change")(function* (
    this: VaultService,
    change: (record: VaultRecord) => VaultRecord,
  ) {
    if (this.#status === "unavailable") return yield* vaultError("error.vault.unavailable");
    if (this.#status === "unreadable") return yield* vaultError("error.vault.unreadable");
    const before = this.#store.read();
    const next = yield* this.#store.update(change);
    if (next === before) return;
    registerSecrets(next);
    this.#emit();
  });

  #emit(): void {
    const state = this.state();
    for (const listener of this.#listeners) listener(state);
  }
}
