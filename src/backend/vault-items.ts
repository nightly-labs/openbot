import type {
  VaultCardBrand,
  VaultContactFields,
  VaultItemKind,
  VaultItemOrigin,
  VaultSaveInput,
} from "@openbot/contracts/ipc";
import type { Effect } from "effect";
import type { PasswordVaultError } from "./password-vault";

interface VaultLoginForAgent extends VaultItemOrigin {
  id: string;
  website: string;
  username: string;
  hasTwoStepKey: boolean;
}

interface VaultCardForAgent extends VaultItemOrigin {
  id: string;
  label: string;
  nameOnCard: string;
  brand: VaultCardBrand | null;
  last4: string;
  expiry: string;
  hasSecurityCode: boolean;
  billingContactId: string | null;
}

interface VaultContactForAgent extends VaultContactFields, VaultItemOrigin {
  id: string;
}

export interface VaultCardSecret {
  number: string;
  securityCode: string;
  expMonth: number;
  expYear: number;
  nameOnCard: string;
}

export type VaultAgentChange =
  | { kind: "contact"; id?: string | undefined; fields: { [Key in keyof VaultContactFields]?: string | undefined } }
  | {
      kind: "login";
      id: string;
      username?: string | undefined;
      password?: string | undefined;
      twoStepKey?: string | undefined;
    }
  | {
      kind: "card";
      id: string;
      label?: string | undefined;
      nameOnCard?: string | undefined;
      expMonth?: number | undefined;
      expYear?: number | undefined;
      billingContactId?: string | null | undefined;
    };

export interface VaultAgentResult {
  id: string;
  kind: VaultItemKind;
  name: string;
}

export interface VaultTypedLogin {
  origin: string;
  username: string;
  password: string;
}

export interface VaultAgent {
  id: string;
  name: string | undefined;
}

interface VaultAgentKey {
  name: string;
  value: string;
  own: boolean;
}

export interface VaultAgentApiKey {
  name: string;
  key: string;
  notes?: string | undefined;
}

export type VaultEnteredItem = Exclude<VaultSaveInput, { kind: "apiKey" }> & { id: null };

export interface VaultItems {
  ready(): boolean;
  apiKeys(agentId: string): VaultAgentKey[];
  sharedApiKeys(): Omit<VaultAgentKey, "own">[];
  hasCards(agentId: string): boolean;
  hasContacts(agentId: string): boolean;
  listForAgent(agentId: string): {
    logins: VaultLoginForAgent[];
    cards: VaultCardForAgent[];
    contacts: VaultContactForAgent[];
  };
  cardSecret(cardId: string, agentId: string): VaultCardSecret | null;
  cardFillApproved(cardId: string, page: string, frames: readonly string[]): boolean;
  approveCardFill(cardId: string, page: string, frames: readonly string[]): Effect.Effect<void, PasswordVaultError>;
  save(
    change: VaultAgentChange,
    agent: VaultAgent,
  ): Effect.Effect<VaultAgentResult & { created: boolean }, PasswordVaultError>;
  delete(id: string, agentId: string): Effect.Effect<VaultAgentResult | null, PasswordVaultError>;
  saveLogin(
    login: VaultTypedLogin,
    agent: VaultAgent,
  ): Effect.Effect<VaultAgentResult & { created: boolean; changed: boolean }, PasswordVaultError>;
  saveApiKey(
    apiKey: VaultAgentApiKey,
    agent: VaultAgent,
    only: boolean,
  ): Effect.Effect<VaultAgentResult & { created: boolean }, PasswordVaultError>;
  removeAgentApiKey(agentId: string, name: string): Effect.Effect<boolean, PasswordVaultError>;
  addEntered(item: VaultEnteredItem, agent: VaultAgent): Effect.Effect<VaultAgentResult, PasswordVaultError>;
}
