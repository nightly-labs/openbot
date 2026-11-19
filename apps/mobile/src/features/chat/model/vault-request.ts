import { type VaultSaveInput, vaultExpiryText } from "@openbot/contracts/ipc";
import {
  type ConversationUiBlock,
  UI_BLOCK_SUBMIT_ACTION_ID,
  type UiBlockSpec,
  type UiVaultRequestKind,
  uiBlockAnswersFromResponse,
} from "@openbot/contracts/ui-blocks";
import type { VaultDraft } from "@/features/servers/model/vault-items";

/**
 * The open `request_vault_item` of one chat card, for the sheet that the card opens. The card keeps
 * it current while it is on the screen: `save` answers the prompt that the card shows.
 */
export interface VaultRequestHandoff {
  serverId: string;
  kind: UiVaultRequestKind;
  title: string;
  prefill: Partial<VaultDraft>;
  save: (input: VaultSaveInput) => Promise<void>;
}

const handoffs = new Map<string, VaultRequestHandoff>();

export function setVaultRequestHandoff(id: string, handoff: VaultRequestHandoff): () => void {
  handoffs.set(id, handoff);
  return () => {
    if (handoffs.get(id) === handoff) handoffs.delete(id);
  };
}

export function vaultRequestHandoff(id: string): VaultRequestHandoff | undefined {
  return handoffs.get(id);
}

/** The Vault request of a block, when the host sent one (`ui-block-vault-v1`). */
export function vaultRequestOf(block: ConversationUiBlock | undefined) {
  return block?.vault && block.spec.type === "form" ? block.vault : undefined;
}

/** The text fields of a Vault request that the agent may fill in, by their form field ids. */
const VAULT_REQUEST_TEXT_KEYS = [
  "website",
  "username",
  "label",
  "nameOnCard",
  "fullName",
  "address",
  "address2",
  "city",
  "region",
  "postalCode",
  "country",
  "phone",
  "email",
] as const satisfies readonly (keyof VaultDraft)[];

/** The fields that the agent filled in, as the text of the Vault item form. A secret field has none. */
export function vaultRequestPrefill(spec: UiBlockSpec): Partial<VaultDraft> {
  if (spec.type !== "form") return {};
  const prefill: Partial<VaultDraft> = {};
  for (const field of spec.fields) {
    if (field.kind !== "text" || field.secret || !field.value) continue;
    const match = field.id === "expiry" ? /^(\d{1,2})\/(\d{2})$/u.exec(field.value) : null;
    if (match?.[1] && match[2]) {
      prefill.expMonth = match[1];
      prefill.expYear = `20${match[2]}`;
    }
    const key = VAULT_REQUEST_TEXT_KEYS.find((candidate) => candidate === field.id);
    if (key) prefill[key] = field.value;
  }
  return prefill;
}

/** The form values of a Vault item, keyed by the field ids of `UI_VAULT_REQUEST_FIELDS`. */
function vaultFormValues(input: VaultSaveInput): Record<string, string> {
  switch (input.kind) {
    case "login":
      return { website: input.website, username: input.username, password: input.password ?? "" };
    case "card":
      return {
        label: input.label,
        nameOnCard: input.nameOnCard,
        number: input.number ?? "",
        expiry: vaultExpiryText(input.expMonth, input.expYear),
        securityCode: input.securityCode ?? "",
      };
    case "contact": {
      const { kind: _kind, id: _id, agents: _agents, ...fields } = input;
      return fields;
    }
    case "apiKey":
      return {};
  }
}

/** The answers of the block's fallback questions that give the host `input`, as the desktop card sends them. */
export function vaultRequestAnswers(spec: UiBlockSpec, input: VaultSaveInput): Record<string, string[]> {
  const values = Object.fromEntries(Object.entries(vaultFormValues(input)).filter(([, value]) => value !== ""));
  return uiBlockAnswersFromResponse(spec, { actionId: UI_BLOCK_SUBMIT_ACTION_ID, values });
}
