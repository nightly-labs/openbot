import { ProviderLogo } from "@openbot/brand";
import { isAgentProvider } from "@openbot/contracts/ipc";
import { Show } from "solid-js";

// A report row names a provider by the string the record carried, so an unrecognized one
// draws nothing rather than a broken glyph. It lives here, and not beside the table that
// reads it most, because the chart's tooltip needs the same mark and the table imports
// the chart.
export function UsageProviderMark(props: { provider: string }) {
  const provider = () => (isAgentProvider(props.provider) ? props.provider : null);
  return (
    <Show when={provider()}>{(value) => <ProviderLogo provider={value()} class="agent-usage-provider-icon" />}</Show>
  );
}
