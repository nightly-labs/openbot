import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type AgentProfileDraft, AVATAR_HUES, type SidebarSection } from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { Button, Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { BloubAvatar } from "./bloub-avatar";

export function AgentProfileSetup({
  agentId,
  onClose,
  onSaved,
}: {
  agentId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { agents, activeServer, generateProfile, saveProfile, getProfileLayout } = useMobileWorkspace();
  const [state, setState] = useState<{
    prompt: string;
    draft: AgentProfileDraft | null;
    sections: SidebarSection[];
    loading: boolean;
    busy: boolean;
    saving: boolean;
    generated: boolean;
    error: string;
    operationId: string;
  }>({
    prompt: "",
    draft: null,
    sections: [],
    loading: true,
    busy: false,
    saving: false,
    generated: false,
    error: "",
    operationId: Crypto.randomUUID(),
  });
  const mounted = useRef(true);
  const load = useRef(getProfileLayout);
  const initialAgent = useRef(agents.find((agent) => agent.id === agentId));
  useEffect(() => {
    let active = true;
    mounted.current = true;
    void load
      .current()
      .then((layout) => {
        if (!active) return;
        const agent = initialAgent.current;
        setState((current) => ({
          ...current,
          loading: false,
          sections: layout.sections,
          draft: agent
            ? {
                name: agent.name,
                title: agent.title,
                description: agent.description,
                avatarSeed: agent.avatarSeed,
                avatarHue: agent.avatarHue,
                sectionId: layout.agentAssignments[agent.id] ?? null,
              }
            : null,
        }));
      })
      .catch(() => {
        if (active)
          setState((current) => ({
            ...current,
            loading: false,
            error: "Could not load sections. Close and try again.",
          }));
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);
  function update(patch: Partial<AgentProfileDraft>) {
    setState((current) => ({
      ...current,
      operationId: Crypto.randomUUID(),
      draft: current.draft ? { ...current.draft, ...patch } : null,
    }));
  }
  async function generate() {
    if (state.busy || state.loading || !state.prompt.trim()) return;
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const layout = await getProfileLayout();
      if (!mounted.current) return;
      setState((current) => ({ ...current, sections: layout.sections }));
      const draft = await generateProfile({
        prompt: state.prompt,
        ...(agentId ? { agentId } : {}),
        ...(state.draft ? { draft: state.draft } : {}),
      });
      if (mounted.current)
        setState((current) => ({ ...current, draft, generated: true, operationId: Crypto.randomUUID() }));
    } catch (error) {
      if (mounted.current)
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Could not generate the profile.",
        }));
    } finally {
      if (mounted.current) setState((current) => ({ ...current, busy: false }));
    }
  }
  async function save() {
    if (!state.draft || state.busy) return;
    setState((current) => ({ ...current, busy: true, saving: true, error: "" }));
    try {
      await saveProfile({
        operationId: state.operationId,
        draft: state.draft,
        ...(agentId
          ? { agentId }
          : {
              initialMessage: `Introduce yourself briefly and explain how you can help. Your standing instructions: ${state.draft.description}`,
            }),
      });
      if (mounted.current) onSaved();
    } catch (error) {
      if (mounted.current)
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Could not save the profile.",
        }));
    } finally {
      if (mounted.current) setState((current) => ({ ...current, busy: false, saving: false }));
    }
  }
  return (
    <View className="gap-5">
      <Typography.Heading type="h4">{agentId ? "Revise agent profile" : "Create from a prompt"}</Typography.Heading>
      <Typography.Paragraph>Review and edit the profile before saving it on {activeServer.name}.</Typography.Paragraph>
      <SheetFormField
        label="Describe your agent"
        multiline
        maxLength={INPUT_LIMITS.messageText}
        value={state.prompt}
        editable={!state.busy}
        onChangeText={(prompt) => setState((current) => ({ ...current, prompt }))}
      />
      <Button isDisabled={state.busy || state.loading || !state.prompt.trim()} onPress={() => void generate()}>
        <Button.Label>
          {state.loading
            ? "Loading sections…"
            : state.busy && !state.saving
              ? "Generating profile…"
              : state.generated
                ? "Revise profile"
                : "Generate profile"}
        </Button.Label>
      </Button>
      {state.draft ? (
        <View className="gap-4">
          <Typography.Heading type="h4">Review profile</Typography.Heading>
          <SheetFormField
            label="Name"
            value={state.draft.name}
            maxLength={INPUT_LIMITS.agentName}
            editable={!state.busy}
            onChangeText={(name) => update({ name })}
          />
          <SheetFormField
            label="Title"
            value={state.draft.title}
            maxLength={INPUT_LIMITS.agentTitle}
            editable={!state.busy}
            onChangeText={(title) => update({ title })}
          />
          <SheetFormField
            label="Standing instructions"
            multiline
            value={state.draft.description}
            maxLength={INPUT_LIMITS.agentDescription}
            editable={!state.busy}
            onChangeText={(description) => update({ description })}
          />
          <BloubAvatar
            preview
            agentId={agentId ?? "profile-preview"}
            seed={state.draft.avatarSeed}
            hue={state.draft.avatarHue}
            size={80}
          />
          <Button
            variant="secondary"
            isDisabled={state.busy}
            onPress={() => update({ avatarSeed: `profile:${Crypto.randomUUID()}` })}
          >
            <Button.Label>Change face</Button.Label>
          </Button>
          <Typography.Paragraph>Avatar color</Typography.Paragraph>
          <View className="flex-row flex-wrap gap-2">
            {[null, ...AVATAR_HUES].map((hue) => (
              <Button
                key={hue ?? "auto"}
                variant={state.draft?.avatarHue === hue ? "primary" : "secondary"}
                accessibilityLabel={hue === null ? "Automatic avatar color" : `Avatar color ${hue}`}
                accessibilityState={{ selected: state.draft?.avatarHue === hue }}
                isDisabled={state.busy}
                onPress={() => update({ avatarHue: hue })}
              >
                {hue === null ? (
                  <Button.Label>Auto</Button.Label>
                ) : (
                  <BloubAvatar
                    preview
                    agentId={agentId ?? "profile-preview"}
                    seed={state.draft?.avatarSeed ?? "profile"}
                    hue={hue}
                    size={28}
                  />
                )}
              </Button>
            ))}
          </View>
          <Typography.Paragraph>Sidebar section</Typography.Paragraph>
          <View className="gap-2">
            {[{ id: "", name: "Unassigned" }, ...state.sections].map((section) => (
              <Button
                key={section.id}
                variant={(state.draft?.sectionId ?? "") === section.id ? "primary" : "secondary"}
                isDisabled={state.busy}
                accessibilityState={{ selected: (state.draft?.sectionId ?? "") === section.id }}
                onPress={() => update({ sectionId: section.id || null })}
              >
                <Button.Label>{section.name}</Button.Label>
              </Button>
            ))}
          </View>
        </View>
      ) : null}
      {state.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger">
          {state.error}
        </Typography.Paragraph>
      ) : null}
      <Button
        isDisabled={state.busy || !state.generated || !state.draft?.name.trim() || !state.draft?.description.trim()}
        onPress={() => void save()}
      >
        <Button.Label>{state.saving ? "Saving profile…" : agentId ? "Save changes" : "Create agent"}</Button.Label>
      </Button>
      <Button variant="secondary" isDisabled={state.saving} onPress={onClose}>
        <Button.Label>Cancel</Button.Label>
      </Button>
    </View>
  );
}
