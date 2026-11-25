import {
  CREDIT_MODEL_COSTS,
  CREDIT_MODEL_MAKERS,
  type CreditActivityEntry,
  type CreditsState,
  creditModelCharge,
  isCreditCode,
  normalizeCreditCode,
} from "@openbot/contracts/credits";
import type { CreditsDesktopApi } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

const MINUTE_MS = 60 * 1_000;
const PREVIEW_CODE_CREDITS = 500;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function generation(
  id: string,
  ago: number,
  modelId: string,
  wallet: Pick<CreditActivityEntry, "actor" | "actorName" | "serverId" | "status">,
): CreditActivityEntry {
  const model = CREDIT_MODEL_COSTS.find((entry) => entry.modelId === modelId) ?? CREDIT_MODEL_COSTS[0];
  const charge = model ? creditModelCharge(model) : 0;
  return {
    id,
    kind: "generation",
    at: Date.now() - ago,
    credits: wallet.status === "failed" || wallet.status === "canceled" ? 0 : -charge,
    ...(model ? { modelName: model.name, maker: CREDIT_MODEL_MAKERS[model.maker] } : {}),
    ...wallet,
  };
}

function previewCreditActivity(): CreditActivityEntry[] {
  const now = Date.now();
  return [
    generation("hold:1", 4 * MINUTE_MS, "veo-3.1", {
      actor: "member",
      actorName: "Maya",
      serverId: "team",
      status: "running",
    }),
    generation("hold:2", 52 * MINUTE_MS, "nano-banana-pro", { actor: "you" }),
    generation("hold:3", 2 * HOUR_MS, "kling-4.0", {
      actor: "member",
      actorName: "Tom",
      serverId: "team",
      status: "failed",
    }),
    generation("hold:4", 3 * HOUR_MS, "seedance-2.5", { actor: "member", actorName: "Maya", serverId: "team" }),
    generation("hold:5", 5 * HOUR_MS, "sync-lipsync-3", { actor: "you", serverId: "design" }),
    { id: "move:1:out", kind: "move", at: now - DAY_MS, credits: -200, actor: "you", otherServerId: "team" },
    { id: "move:1:in", kind: "move", at: now - DAY_MS, credits: 200, actor: "you", serverId: "team" },
    { id: "purchase:1", kind: "purchase", at: now - DAY_MS - HOUR_MS, credits: 1_000, actor: "you" },
    generation("hold:6", 2 * DAY_MS, "chatgpt-image-2", { actor: "you" }),
    { id: "grant:1", kind: "free", at: now - 3 * DAY_MS, credits: 50, actor: "openbot" },
    generation("hold:7", 4 * DAY_MS, "veo-3.1-fast", { actor: "member", actorName: "Tom", serverId: "team" }),
    { id: "expiry:1", kind: "expired", at: now - 5 * DAY_MS, credits: -12, actor: "openbot" },
    { id: "refund:1", kind: "refund", at: now - 9 * DAY_MS, credits: -500, actor: "you", serverId: "team" },
    { id: "purchase:2", kind: "purchase", at: now - 10 * DAY_MS, credits: 2_500, actor: "you", serverId: "team" },
  ];
}

function previewCreditsState(): CreditsState {
  return {
    available: true,
    currency: "eur",
    currencies: ["eur", "usd", "pln"],
    balance: 640.5,
    expiring: { credits: 50, expiresAt: Date.now() + 12 * DAY_MS },
    servers: [
      {
        serverId: "team",
        name: "OpenBot team",
        role: "owner",
        balance: 1_799.5,
        expiring: { credits: 30, expiresAt: Date.now() + 12 * DAY_MS },
      },
      { serverId: "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f", name: "Research server", role: "owner", balance: 0 },
      { serverId: "design", name: "Design team", role: "member", balance: 300 },
    ],
  };
}

export function createMockCredits(initial: Partial<CreditsState> = {}): CreditsDesktopApi {
  const state: CreditsState = { ...previewCreditsState(), ...initial };
  const activity = previewCreditActivity();
  const server = (serverId: string) => state.servers.find((wallet) => wallet.serverId === serverId);
  const redeemed = new Set<string>();
  return {
    getState: async () => structuredClone(state),
    getActivity: async () => ({ entries: structuredClone(activity) }),
    openCheckout: async (request) => {
      if (request.serverId === undefined) {
        state.balance += request.credits;
        return;
      }
      const wallet = server(request.serverId);
      if (!wallet) throw new Error(sourceText("error.billing.creditsServerMember"));
      wallet.balance += request.credits;
    },
    transfer: async (request) => {
      const wallet = server(request.serverId);
      if (wallet?.role !== "owner") throw new Error(sourceText("error.billing.creditsServerOwner"));
      const toServer = request.direction === "to_server";
      const available = toServer ? state.balance : wallet.balance;
      if (available < request.credits) throw new Error(sourceText("error.billing.creditsNotEnough"));
      const change = toServer ? request.credits : -request.credits;
      state.balance -= change;
      wallet.balance += change;
      const at = Date.now();
      const id = `move:${at}`;
      activity.unshift(
        { id: `${id}:out`, kind: "move", at, credits: -change, actor: "you", otherServerId: request.serverId },
        { id: `${id}:in`, kind: "move", at, credits: change, actor: "you", serverId: request.serverId },
      );
      return structuredClone(state);
    },
    redeem: async (request) => {
      const code = normalizeCreditCode(request.code);
      if (!isCreditCode(code)) throw new Error(sourceText("error.billing.creditCodeInvalid"));
      if (redeemed.has(code)) throw new Error(sourceText("error.billing.creditCodeRedeemed"));
      const wallet = request.serverId === undefined ? null : server(request.serverId);
      if (wallet === undefined) throw new Error(sourceText("error.billing.creditCodeServerMember"));
      redeemed.add(code);
      if (wallet) wallet.balance += PREVIEW_CODE_CREDITS;
      else state.balance += PREVIEW_CODE_CREDITS;
      const at = Date.now();
      activity.unshift({
        id: `grant:code:${at}`,
        kind: "free",
        at,
        credits: PREVIEW_CODE_CREDITS,
        actor: "you",
        ...(request.serverId === undefined ? {} : { serverId: request.serverId }),
      });
      return { credits: PREVIEW_CODE_CREDITS, state: structuredClone(state) };
    },
  };
}
