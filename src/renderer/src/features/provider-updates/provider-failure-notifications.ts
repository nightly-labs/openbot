import {
  AGENT_PROVIDERS,
  type AgentEvent,
  type AgentProviderId,
  type AgentProviderStatus,
} from "@openbot/contracts/ipc";
import { redactedSummary } from "@openbot/logging";
import { toast } from "../../components/ui";

/** Notifications for one server scope. A dismissed failure stays closed until it changes or recovers. */
export function createProviderFailureNotifications(options: {
  serverId: string;
  remoteName: () => string | undefined;
  openSettings: (event: MouseEvent) => void;
  settingsAvailable?: () => boolean;
}) {
  const failures = new Map<AgentProviderId, { description: string; settingsAvailable: boolean; dismissed: boolean }>();
  const id = (provider: AgentProviderId): string => `provider-failure-${options.serverId}-${provider}`;

  function report(provider: AgentProviderId, message: string): void {
    const description = redactedSummary(message) || "The provider could not start. Try again.";
    const remoteName = options.remoteName();
    const settingsAvailable = !remoteName && (options.settingsAvailable?.() ?? true);
    const previous = failures.get(provider);
    if (
      previous?.description === description &&
      (previous.dismissed || previous.settingsAvailable === settingsAvailable)
    )
      return;
    const failure = { description, settingsAvailable, dismissed: false };
    failures.set(provider, failure);
    const name = provider === "codex" ? "ChatGPT" : provider === "claude" ? "Claude" : "Grok";
    toast.error(`${name} could not start${remoteName ? ` on ${remoteName}` : ""}`, {
      id: id(provider),
      description,
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      action: settingsAvailable ? { label: "Open Settings", onClick: options.openSettings } : undefined,
      onDismiss: () => {
        failure.dismissed = true;
      },
    });
  }

  function clear(provider: AgentProviderId): void {
    if (!failures.delete(provider)) return;
    toast.dismiss(id(provider));
  }

  return {
    sync(statuses: AgentProviderStatus[]): void {
      for (const status of statuses) {
        if (status.state === "error") report(status.id, status.message ?? "");
        else if (status.state === "available") clear(status.id);
      }
    },
    handleError(event: Extract<AgentEvent, { type: "error" }>, statuses: AgentProviderStatus[]): void {
      if (event.agentId) return;
      const provider = AGENT_PROVIDERS.find(
        (provider) => event.code === `${provider}_start_failed` || event.code === `${provider}_runtime_missing`,
      );
      if (!provider) return;
      const status = statuses.find((status) => status.id === provider);
      report(provider, status?.state === "error" ? (status.message ?? event.message) : event.message);
    },
    dispose(): void {
      for (const provider of failures.keys()) clear(provider);
    },
  };
}
