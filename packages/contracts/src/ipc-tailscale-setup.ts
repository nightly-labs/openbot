/**
 * The Tailscale setup of a joined server, for its owner (`host-tailscale-v1`): the state of the
 * host's Tailscale client and direct path, and the state of the Tailscale client on this computer.
 * Main reads both and compares the tailnets; the renderer only shows the result.
 */

import {
  TAILSCALE_DIRECT_ISSUES,
  TAILSCALE_LOCAL_STATES,
  type TailscaleDirectIssue,
  type TailscaleLocalStateKind,
} from "./ipc-team-host";
import { type DynamicRecord, isBoolean, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const TAILSCALE_HOST_ENVIRONMENTS = ["linux", "wsl", "other"] as const;
/** `linux` is a Linux host, `wsl` a Linux host in WSL on Windows, `other` a macOS or Windows host. */
export type TailscaleHostEnvironment = (typeof TAILSCALE_HOST_ENVIRONMENTS)[number];

export const TAILSCALE_WSL_NETWORKING_MODES = ["mirrored", "nat", "unknown"] as const;
export type TailscaleWslNetworking = (typeof TAILSCALE_WSL_NETWORKING_MODES)[number];

export const TAILSCALE_SIGN_IN_ISSUES = ["needs-setup", "failed"] as const;
/** `needs-setup`: the host may not run `tailscale up`; the owner runs the setup command first. */
export type TailscaleSignInIssue = (typeof TAILSCALE_SIGN_IN_ISSUES)[number];

/** The host side, as the owner's client receives it. */
export interface HostTailscaleSetup {
  state: TailscaleLocalStateKind;
  tailnet: string | null;
  deviceName: string | null;
  /** The host's MagicDNS name, such as `home-server.tail4b2c1.ts.net`. */
  dnsName: string | null;
  httpsCertificates: boolean;
  /** The owner's switch for the direct path. */
  enabled: boolean;
  url: string | null;
  issue: TailscaleDirectIssue | null;
  issueDetail: string | null;
  /** The Tailscale sign-in page of the host, while its Tailscale client waits for a sign-in. */
  loginUrl: string | null;
  environment: TailscaleHostEnvironment;
  /** Null when the host is not in WSL, or uses a Tailscale installed in WSL. */
  wslNetworking: TailscaleWslNetworking | null;
  /** The host is a self-hosted server with the `sudo openbot tailscale setup` command. */
  setupCommand: boolean;
  signInIssue: TailscaleSignInIssue | null;
}

/** The Tailscale client of this computer. */
export interface TailscaleClientState {
  state: TailscaleLocalStateKind;
  tailnet: string | null;
  deviceName: string | null;
}

/**
 * How this computer reaches the host in Tailscale: `same` tailnet, a host device `shared` into this
 * computer's tailnet, or `other` when it cannot see the host. Null until both are connected.
 */
export type TailscaleNetworkMatch = "same" | "shared" | "other";

export interface TailscaleSetupStatus {
  client: TailscaleClientState;
  host: HostTailscaleSetup;
  network: TailscaleNetworkMatch | null;
}

function nullableText(record: DynamicRecord, key: string): string | null {
  const value = record[key];
  if (value !== null && !isString(value)) throw new Error(`Invalid ${key}.`);
  return value;
}

function nullableChoice<T extends string>(record: DynamicRecord, key: string, choices: readonly T[]): T | null {
  const value = record[key];
  if (value === null) return null;
  if (!isOneOf(choices, value)) throw new Error(`Invalid ${key}.`);
  return value;
}

function flag(record: DynamicRecord, key: string): boolean {
  const value = record[key];
  if (!isBoolean(value)) throw new Error(`Invalid ${key}.`);
  return value;
}

/** Reads the host snapshot. On the wire the route codec has already checked each field. */
export function decodeHostTailscaleSetup(value: unknown): HostTailscaleSetup {
  if (!isDynamicRecord(value)) throw new Error("Invalid host Tailscale state.");
  const state = nullableChoice(value, "state", TAILSCALE_LOCAL_STATES);
  const environment = nullableChoice(value, "environment", TAILSCALE_HOST_ENVIRONMENTS);
  if (!state || !environment) throw new Error("Invalid host Tailscale state.");
  return {
    state,
    tailnet: nullableText(value, "tailnet"),
    deviceName: nullableText(value, "deviceName"),
    dnsName: nullableText(value, "dnsName"),
    httpsCertificates: flag(value, "httpsCertificates"),
    enabled: flag(value, "enabled"),
    url: nullableText(value, "url"),
    issue: nullableChoice(value, "issue", TAILSCALE_DIRECT_ISSUES),
    issueDetail: nullableText(value, "issueDetail"),
    loginUrl: nullableText(value, "loginUrl"),
    environment,
    wslNetworking: nullableChoice(value, "wslNetworking", TAILSCALE_WSL_NETWORKING_MODES),
    setupCommand: flag(value, "setupCommand"),
    signInIssue: nullableChoice(value, "signInIssue", TAILSCALE_SIGN_IN_ISSUES),
  };
}

export function decodeTailscaleSetupStatus(value: unknown): TailscaleSetupStatus {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.client)) throw new Error("Invalid Tailscale setup.");
  const client = value.client;
  const clientState = nullableChoice(client, "state", TAILSCALE_LOCAL_STATES);
  if (!clientState) throw new Error("Invalid Tailscale setup.");
  const network = value.network;
  if (network !== null && network !== "same" && network !== "shared" && network !== "other")
    throw new Error("Invalid Tailscale setup.");
  return {
    client: {
      state: clientState,
      tailnet: nullableText(client, "tailnet"),
      deviceName: nullableText(client, "deviceName"),
    },
    host: decodeHostTailscaleSetup(value.host),
    network,
  };
}
