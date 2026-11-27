import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentInstructionsFile } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Typography } from "heroui-native";
import { useRef, useState } from "react";
import { InstructionsLimit, instructionsTooLong } from "@/features/agents/components/instructions-limit";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { type MobileAgent, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SaveError } from "@/shared/components/save-error";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useDiscardGuard } from "@/shared/lib/use-discard-guard";

const LIMIT = INPUT_LIMITS.agentInstructionsFile;

export function AgentInstructionsFileEditor({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t, errorMessage } = useText();
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.agentRecord(queryScope, agent.serverId, agent.id, "instructions");
  const file = useQuery({
    queryKey,
    queryFn: () => workspace.loadAgentInstructions(agent.id, agent.serverId),
    enabled: available,
    retry: false,
    staleTime: 0,
  });
  const [edited, setEdited] = useState<string | undefined>();
  const [base, setBase] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const savedText = file.data?.text ?? "";
  const text = edited ?? savedText;
  const dirty = edited !== undefined && edited !== (base ?? savedText);
  const tooLong = instructionsTooLong(text, LIMIT);

  useDiscardGuard(dirty || saving, { busy: () => pending.current });

  async function saved(next: AgentInstructionsFile): Promise<void> {
    await queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<AgentInstructionsFile>(queryKey, next);
    setEdited(undefined);
    setBase(undefined);
    void haptics.notification("success");
  }

  async function save(): Promise<void> {
    if (!file.data || !dirty || tooLong || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    const expected = base ?? file.data.text;
    try {
      const next = await workspace.saveAgentInstructions({ agentId: agent.id, text, expected }, agent.serverId);
      await saved(next);
    } catch (cause) {
      const latest = await workspace.loadAgentInstructions(agent.id, agent.serverId).catch(() => null);
      if (latest?.text === text) {
        await saved(latest);
        return;
      }
      void haptics.notification("error");
      const current = latest?.text ?? null;
      if (current !== null && current !== expected) {
        setBase(current);
        setError(t("mobile.agent.instructionsFile.changed"));
      } else setError(errorMessage(cause, t("mobile.agent.instructionsFile.saveFailed")));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  if (file.isError && !file.data)
    return (
      <>
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {errorMessage(file.error, t("mobile.agent.instructionsFile.readFailed"))}
        </Typography.Paragraph>
        <Button variant="ghost" onPress={() => void file.refetch()}>
          <Button.Label>{t("common.retry")}</Button.Label>
        </Button>
      </>
    );
  if (!file.data)
    return available ? <Typography.Paragraph>{t("mobile.agent.instructionsFile.loading")}</Typography.Paragraph> : null;
  return (
    <>
      <SheetFormField
        label={file.data.fileName}
        appearance="soft"
        placeholder={t("mobile.agent.instructionsFile.placeholder")}
        multiline
        tall
        autoCapitalize="sentences"
        value={text}
        editable={available && !saving}
        onChangeText={(value) => {
          if (base === undefined) setBase(savedText);
          setEdited(value);
          setError(null);
        }}
      />
      <InstructionsLimit text={text} limit={LIMIT} />
      <Typography.Paragraph type="body-xs" className="px-1 text-text-secondary">
        {t("mobile.agent.instructionsFile.footer")}
      </Typography.Paragraph>
      <SaveError error={error} />
      <SheetSaveAction dirty={dirty} canSave={available && !tooLong} pending={saving} onSave={() => void save()} />
    </>
  );
}
