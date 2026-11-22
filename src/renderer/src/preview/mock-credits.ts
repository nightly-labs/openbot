import type { CreditsState } from "@openbot/contracts/credits";
import type { CreditsDesktopApi } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

const DAY_MS = 24 * 60 * 60 * 1_000;

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
  const server = (serverId: string) => state.servers.find((wallet) => wallet.serverId === serverId);
  return {
    getState: async () => structuredClone(state),
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
      return structuredClone(state);
    },
  };
}
