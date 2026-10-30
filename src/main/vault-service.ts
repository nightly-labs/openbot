// The Vault of this computer: logins, payment cards, contact info and API keys that the user saves in
// Server settings. Agents fill logins through the `PasswordVault` port (`openbot:` IDs) and cards and
// contact info through `VaultItems`; neither port gives an agent a password, a card number or a security
// code. Agents can also add and change items through `VaultItems`, but cannot set a secret. API keys
// reach an agent only as files that `AgentApiKeys` writes; agents cannot see or change them as items.

import { randomUUID } from "node:crypto";
import {
  cardBrand,
  VAULT_FILL_SITE_LIMIT,
  VAULT_NOTES_LIMIT,
  VAULT_PASSWORD_LIMIT,
  VAULT_TEXT_LIMIT,
  type VaultContactFields,
  type VaultImportResult,
  type VaultItemSummary,
  type VaultSaveInput,
  type VaultSecretRequest,
  type VaultState,
  type VaultStatus,
} from "@openbot/contracts/ipc";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import { registerSecretValues } from "@openbot/logging";
import { Effect } from "effect";
import { type PasswordVault, PasswordVaultError, websiteMatchesOrigin, websiteUrl } from "../backend/password-vault";
import type {
  VaultAgentChange,
  VaultAgentResult,
  VaultCardSecret,
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
 * a three-digit pattern would remove numbers from every log line. It reaches only the page.
 */
function registerSecrets(record: VaultRecord): void {
  registerSecretValues(
    record.logins.map((login) => login.password),
    { allowShort: true },
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

function loginTitle(website: string): string {
  return websiteUrl(website)?.hostname ?? website;
}

/** The agent that added an item, kept when the user or another agent changes it. */
function origin(existing: { addedBy?: string } | undefined, addedBy: string | undefined): { addedBy?: string } {
  const name = existing ? existing.addedBy : addedBy;
  return name === undefined ? {} : { addedBy: name };
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
        password: null,
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
        kind: "login",
        website: login.website,
        username: login.username,
        notes: login.notes,
        hasPassword: login.password.length > 0,
      }),
    ),
    ...record.cards.map(
      (card): VaultItemSummary => ({
        id: card.id,
        ...origin(card, undefined),
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
    ...record.contacts.map((contact): VaultItemSummary => ({ ...contact, kind: "contact" })),
    ...record.apiKeys.map(
      (apiKey): VaultItemSummary => ({
        id: apiKey.id,
        ...origin(apiKey, undefined),
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
    return { status: this.#status, items: this.#status === "ready" ? summary(this.#store.read()) : [] };
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
   * password, or the same login is already saved.
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
        const duplicate =
          valid &&
          logins.some(
            (login) =>
              loginTitle(login.website) === loginTitle(website) &&
              login.username === row.username &&
              login.password === row.password,
          );
        if (!valid || duplicate) {
          skipped += 1;
          continue;
        }
        logins.push({
          id: randomUUID(),
          website,
          username: row.username,
          password: row.password,
          notes: row.notes.slice(0, VAULT_NOTES_LIMIT),
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

  /** The built-in logins, for the password vault router under the `openbot:` prefix. */
  readonly logins: PasswordVault = {
    connected: () => this.#status === "ready" && this.#store.read().logins.length > 0,
    loginsFor: (origin) =>
      Effect.sync(() => {
        if (this.#status !== "ready") return null;
        return this.#store
          .read()
          .logins.filter((login) => websiteMatchesOrigin({ url: login.website, autofill: "anywhere" }, origin))
          .map((login) => ({
            id: login.id,
            title: loginTitle(login.website),
            username: login.username || null,
            hasOneTimePassword: false,
          }));
      }),
    secretFor: (loginId, origin, kind) =>
      Effect.sync(() => {
        if (this.#status !== "ready" || kind !== "password") return null;
        const login = this.#store.read().logins.find((item) => item.id === loginId);
        if (!login?.password || !websiteMatchesOrigin({ url: login.website, autofill: "anywhere" }, origin))
          return null;
        return login.password;
      }),
  };

  readonly #agentSave = Effect.fn("VaultService.agentSave")(function* (
    this: VaultService,
    change: VaultAgentChange,
    addedBy: string | undefined,
  ) {
    // The change runs inside the store's write, so the result is kept here.
    const outcome: { saved: (VaultAgentResult & { created: boolean }) | null } = { saved: null };
    yield* this.#change((record) => {
      const input = agentSaveInput(record, change);
      const next = this.#put(record, input, addedBy);
      const named = itemName(next.record, next.id);
      outcome.saved = named && { ...named, created: input.id === null };
      return next.record;
    });
    return outcome.saved ?? (yield* vaultError("error.vault.itemMissing"));
  });

  readonly #agentDelete = Effect.fn("VaultService.agentDelete")(function* (this: VaultService, id: string) {
    const outcome: { deleted: VaultAgentResult | null } = { deleted: null };
    yield* this.#change((record) => {
      // An agent does not see API keys as items, so it cannot delete one.
      const named = itemName(record, id);
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
    addedBy: string | undefined,
  ) {
    const website = vaultWebsite(login.origin);
    if (!website || login.username.length > VAULT_TEXT_LIMIT) return yield* vaultError("error.vault.websiteInvalid");
    if (!login.password.trim() || login.password.length > VAULT_PASSWORD_LIMIT)
      return yield* vaultError("error.vault.passwordRequired");
    const username = login.username.trim();
    const outcome: { saved: (VaultAgentResult & { created: boolean; changed: boolean }) | null } = { saved: null };
    yield* this.#change((record) => {
      const existing = record.logins.find(
        (item) =>
          item.username === username && websiteMatchesOrigin({ url: item.website, autofill: "anywhere" }, website),
      );
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
            ...origin(undefined, addedBy),
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

  /** The cards and contact info, for the browser tools, and the API keys, for `AgentApiKeys`. */
  readonly items: VaultItems = {
    ready: () => this.#status === "ready",
    apiKeys: () =>
      this.#status === "ready" ? this.#store.read().apiKeys.map(({ name, key }) => ({ name, value: key })) : [],
    hasCards: () => this.#status === "ready" && this.#store.read().cards.length > 0,
    hasContacts: () => this.#status === "ready" && this.#store.read().contacts.length > 0,
    listForAgent: () => {
      if (this.#status !== "ready") return { logins: [], cards: [], contacts: [] };
      const record = this.#store.read();
      return {
        logins: record.logins.map((login) => ({
          id: login.id,
          website: login.website,
          username: login.username,
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
        contacts: record.contacts.map((contact) => ({ ...contact })),
      };
    },
    cardSecret: (cardId): VaultCardSecret | null => {
      if (this.#status !== "ready") return null;
      const card = this.#store.read().cards.find((item) => item.id === cardId);
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
    save: (change, addedBy) => this.#agentSave(change, addedBy),
    delete: (id) => this.#agentDelete(id),
    saveLogin: (login, addedBy) => this.#saveTypedLogin(login, addedBy),
  };

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
        const { kind: _kind, id, ...fields } = input;
        const existing = id === null ? undefined : this.#find(record.contacts, id);
        const contact: StoredContact = { ...fields, id: existing?.id ?? randomUUID(), ...origin(existing, addedBy) };
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
    return {
      id: existing?.id ?? randomUUID(),
      website: input.website,
      username: input.username,
      notes: input.notes,
      password,
      ...origin(existing, addedBy),
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
    };
  }

  /** A name names one key: an agent reads the key by its name. */
  #apiKey(
    record: VaultRecord,
    input: Extract<VaultSaveInput, { kind: "apiKey" }>,
    addedBy: string | undefined,
  ): StoredApiKey {
    const existing = input.id === null ? undefined : this.#find(record.apiKeys, input.id);
    const key = input.key ?? existing?.key;
    if (!key) return refuse("error.vault.apiKeyRequired");
    if (record.apiKeys.some((item) => item.name === input.name && item.id !== existing?.id))
      return refuse("error.vault.apiKeyNameTaken");
    return {
      id: existing?.id ?? randomUUID(),
      name: input.name,
      key,
      notes: input.notes,
      ...origin(existing, addedBy),
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
