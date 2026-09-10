import { Host, Picker } from "@expo/ui";
import type { AgentProviderId, AgentReasoningEffort, UpdateAgentInput } from "@openbot/contracts/ipc";
import { useQuery } from "@tanstack/react-query";
import { Button, Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

export function AgentRuntimeFields({
  agent,
  available,
  saving,
  provider,
  model,
  reasoningEffort,
  onChange,
}: {
  agent: MobileAgent;
  available: boolean;
  saving: boolean;
  provider?: AgentProviderId;
  model?: string;
  reasoningEffort?: AgentReasoningEffort;
  onChange: (value: Pick<UpdateAgentInput, "provider" | "model" | "reasoningEffort">) => void;
}) {
  const workspace = useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const { theme } = useUniwind();
  const models = useQuery({
    queryKey: ["agent-models", session?.apiUrl, session?.user.id, sessionScope, agent.serverId],
    queryFn: () => workspace.loadAgentModels(agent.serverId),
    enabled: available,
    retry: false,
  });
  const options = models.data?.filter((option) => option.provider === provider) ?? [];
  const selected = options.find((option) => option.id === model);
  const enabled = available && !saving && options.length > 0;
  return (
    <>
      <SettingsSection title="Runtime">
        <SettingsRow
          trailing={
            <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
              <Picker
                selectedValue={provider ?? ""}
                enabled={available && !saving && Boolean(models.data?.length)}
                onValueChange={(value) => {
                  const next = models.data?.find((option) => option.provider === value);
                  if (next)
                    onChange({ provider: next.provider, model: next.id, reasoningEffort: next.defaultReasoningEffort });
                }}
              >
                {!models.data?.some((option) => option.provider === provider) ? (
                  <Picker.Item label={provider ?? "Unavailable"} value={provider ?? ""} />
                ) : null}
                {Array.from(new Set(models.data?.map((option) => option.provider))).map((value) => (
                  <Picker.Item
                    key={value}
                    label={value === "codex" ? "Codex" : value === "claude" ? "Claude" : "Grok"}
                    value={value}
                  />
                ))}
              </Picker>
            </Host>
          }
        >
          <Typography.Paragraph>Provider</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          trailing={
            <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
              <Picker
                selectedValue={model ?? ""}
                enabled={enabled}
                onValueChange={(id) => {
                  const next = options.find((option) => option.id === id);
                  if (!next) return;
                  onChange({
                    model: next.id,
                    reasoningEffort:
                      reasoningEffort && next.supportedReasoningEfforts.includes(reasoningEffort)
                        ? reasoningEffort
                        : next.defaultReasoningEffort,
                  });
                }}
              >
                {!selected ? <Picker.Item label={model ?? "Unavailable"} value={model ?? ""} /> : null}
                {options.map((option) => (
                  <Picker.Item key={option.id} label={option.name} value={option.id} />
                ))}
              </Picker>
            </Host>
          }
        >
          <Typography.Paragraph>Model</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          trailing={
            <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
              <Picker
                selectedValue={reasoningEffort ?? ""}
                enabled={enabled && Boolean(selected?.supportedReasoningEfforts.length)}
                onValueChange={(effort) => {
                  const next = selected?.supportedReasoningEfforts.find((option) => option === effort);
                  if (next) onChange({ reasoningEffort: next });
                }}
              >
                {!reasoningEffort || !selected?.supportedReasoningEfforts.includes(reasoningEffort) ? (
                  <Picker.Item label={reasoningEffort ?? "Unavailable"} value={reasoningEffort ?? ""} />
                ) : null}
                {selected?.supportedReasoningEfforts.map((effort) => (
                  <Picker.Item
                    key={effort}
                    label={effort === "xhigh" ? "Extra high" : effort[0].toUpperCase() + effort.slice(1)}
                    value={effort}
                  />
                ))}
              </Picker>
            </Host>
          }
        >
          <Typography.Paragraph>Reasoning</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {models.isError ? (
        <Button variant="ghost" onPress={() => void models.refetch()}>
          <Button.Label>Retry models</Button.Label>
        </Button>
      ) : available && models.isPending ? (
        <Typography.Paragraph>Loading models…</Typography.Paragraph>
      ) : available && !options.length ? (
        <Typography.Paragraph>No models available for this provider.</Typography.Paragraph>
      ) : null}
    </>
  );
}
