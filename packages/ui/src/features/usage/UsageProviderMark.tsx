import { ProviderLogo } from "@openbot/brand";
import { isAgentProvider } from "@openbot/contracts/ipc";
import { Show } from "solid-js";

export function UsageProviderMark(props: { provider: string }) {
  const provider = () => (isAgentProvider(props.provider) ? props.provider : null);
  return (
    <Show when={provider()}>{(value) => <ProviderLogo provider={value()} class="agent-usage-provider-icon" />}</Show>
  );
}
