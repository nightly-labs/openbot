import type { PasswordManagerId, PasswordManagerStatus } from "@openbot/contracts/ipc";

/**
 * The password managers that the phone connects through the shared engine of the host
 * (`password-managers-v1`). 1Password and Bitwarden keep their own pages and routes. To add a
 * manager, add its id here with its text and its sign-in site.
 */
const MOBILE_PASSWORD_MANAGER_IDS = ["protonpass"] as const satisfies readonly PasswordManagerId[];

export type MobilePasswordManagerId = (typeof MOBILE_PASSWORD_MANAGER_IDS)[number];

export function isMobilePasswordManagerId(value: string): value is MobilePasswordManagerId {
  return MOBILE_PASSWORD_MANAGER_IDS.some((id) => id === value);
}

/** The text that is different for each manager. The shared page writes the rest with `{name}`. */
export const PASSWORD_MANAGER_TEXT = {
  protonpass: {
    description: "mobile.server.connectors.protonPass.description",
    keyHelp: "mobile.server.connectors.protonPass.keyHelp",
    keyPlaceholder: "mobile.server.connectors.protonPass.keyPlaceholder",
  },
} as const satisfies Record<MobilePasswordManagerId, Record<"description" | "keyHelp" | "keyPlaceholder", string>>;

/**
 * The site of each manager's sign-in page. A joined server names the page that the phone opens, so
 * the phone opens only a page of this site or of a subdomain.
 */
const SIGN_IN_SITES = {
  protonpass: "proton.me",
} as const satisfies Record<MobilePasswordManagerId, string>;

/**
 * `address` when it is an https page of the manager's sign-in site, otherwise null. The React Native
 * `URL` does not parse a host strictly, so this reads the host up to the first `/`, `?` or `#`, and
 * the host can have only letters, digits, dots and hyphens: no user, port or other character.
 */
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

/** True when the host's access key expired, so the user connects again. */
export function passwordManagerExpired(status: PasswordManagerStatus, now: number): boolean {
  if (status.errorCode === "expired") return true;
  return status.state === "connected" && status.expiresAt !== null && status.expiresAt <= now;
}

/** How the connector list and the page header show a manager. */
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
