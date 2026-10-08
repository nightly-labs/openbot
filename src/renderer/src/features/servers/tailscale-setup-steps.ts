import type { TailscaleSetupStatus } from "@openbot/contracts/ipc";

const TAILSCALE_SETUP_STEP_IDS = ["client", "server", "network", "https", "direct"] as const;
export type TailscaleSetupStepId = (typeof TAILSCALE_SETUP_STEP_IDS)[number];

/** `waiting`: an earlier step must be done first, so this one cannot be checked yet. */
type TailscaleSetupStepState = "done" | "action" | "waiting";

export interface TailscaleSetupStep {
  id: TailscaleSetupStepId;
  state: TailscaleSetupStepState;
}

/** The setup command of a self-hosted server. `scripts/hosting/openbot` runs it as root. */
export const TAILSCALE_SETUP_COMMAND = "sudo openbot tailscale setup";

/** The owner's five setup steps, each checked from the current state of both Tailscale clients. */
export function tailscaleSetupSteps(status: TailscaleSetupStatus): TailscaleSetupStep[] {
  const clientReady = status.client.state === "connected";
  const serverReady = status.host.state === "connected";
  const httpsReady = serverReady && status.host.httpsCertificates;
  const step = (ready: boolean, done: boolean): TailscaleSetupStepState =>
    !ready ? "waiting" : done ? "done" : "action";
  return [
    { id: "client", state: clientReady ? "done" : "action" },
    { id: "server", state: serverReady ? "done" : "action" },
    {
      id: "network",
      state: step(clientReady && serverReady, status.network === "same" || status.network === "shared"),
    },
    { id: "https", state: step(serverReady, status.host.httpsCertificates) },
    { id: "direct", state: step(httpsReady, status.host.enabled && status.host.url !== null) },
  ];
}

export function tailscaleSetupComplete(status: TailscaleSetupStatus): boolean {
  return tailscaleSetupSteps(status).every((step) => step.state === "done");
}

/**
 * What the server step offers while the server is not connected. A server in WSL uses the Windows
 * app. A self-hosted server shows its setup command until Tailscale is installed and may be started
 * by OpenBot; another server gets the download page.
 */
export type TailscaleServerAction = "windows-app" | "setup-command" | "sign-in" | "download";

export function tailscaleServerActions(status: TailscaleSetupStatus): TailscaleServerAction[] {
  const host = status.host;
  if (host.state === "connected") return [];
  if (host.environment === "wsl") return host.state === "not-installed" ? ["windows-app"] : ["windows-app", "sign-in"];
  const needsSetup = host.state === "not-installed" || host.signInIssue === "needs-setup";
  if (host.setupCommand) return needsSetup ? ["setup-command"] : ["sign-in", "setup-command"];
  return host.state === "not-installed" ? ["download"] : ["sign-in", "download"];
}

/** Mirrored networking matters while the server uses the Windows app from WSL. */
export function tailscaleWslHint(status: TailscaleSetupStatus): "mirrored-required" | "mirrored-check" | null {
  const { environment, wslNetworking } = status.host;
  if (environment !== "wsl" || wslNetworking === null || wslNetworking === "mirrored") return null;
  return wslNetworking === "nat" ? "mirrored-required" : "mirrored-check";
}
