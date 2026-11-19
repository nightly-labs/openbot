import type { PasswordManagerId, PasswordManagerStatus } from "@openbot/contracts/ipc";

const MOBILE_PASSWORD_MANAGER_IDS = ["protonpass"] as const satisfies readonly PasswordManagerId[];

export type MobilePasswordManagerId = (typeof MOBILE_PASSWORD_MANAGER_IDS)[number];

export function isMobilePasswordManagerId(value: string): value is MobilePasswordManagerId {
  return MOBILE_PASSWORD_MANAGER_IDS.some((id) => id === value);
}

export const PASSWORD_MANAGER_TEXT = {
  protonpass: {
    description: "mobile.server.connectors.protonPass.description",
    keyHelp: "mobile.server.connectors.protonPass.keyHelp",
    keyPlaceholder: "mobile.server.connectors.protonPass.keyPlaceholder",
    plan: "mobile.server.connectors.protonPass.plan",
  },
} as const satisfies Record<
  MobilePasswordManagerId,
  Record<"description" | "keyHelp" | "keyPlaceholder" | "plan", string>
>;

const SIGN_IN_SITES = {
  protonpass: "proton.me",
} as const satisfies Record<MobilePasswordManagerId, string>;

export function passwordManagerSignInPage(manager: MobilePasswordManagerId, address: string | null): string | null {
  if (address === null || !address.startsWith("https://")) return null;
  const rest = address.slice("https://".length);
  const end = rest.search(/[/?#]/u);
  const host = (end < 0 ? rest : rest.slice(0, end)).toLowerCase();
  const path = end < 0 ? "" : rest.slice(end);
  const site = SIGN_IN_SITES[manager];
  if (!/^[a-z0-9.-]+$/u.test(host) || !(host === site || host.endsWith(`.${site}`))) return null;
  return /^[^\s\\]*$/u.test(path) ? address : null;
}

export function passwordManagerExpired(status: PasswordManagerStatus, now: number): boolean {
  if (status.errorCode === "expired") return true;
  return status.state === "connected" && status.expiresAt !== null && status.expiresAt <= now;
}

export function passwordManagerConnectorStatus(status: PasswordManagerStatus, now: number) {
  if (passwordManagerExpired(status, now)) return "attention";
  switch (status.state) {
    case "connected":
      return "connected";
    case "signing-in":
      return "connecting";
    case "failed":
      return "attention";
    default:
      return "idle";
  }
}
