import type { InstalledSkill, MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import { Button, Switch } from "@openbot/ui";
import { SkillGlyph } from "@openbot/ui/features/conversation/SkillGlyph";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, createStore, For, onSettled, Show } from "solid-js";
import { SkillPreview } from "../../components/SkillPreview";
import { skillsPort } from "../../skills-port";

export function LocalSkillsLibrary(props: {
  initialSkillId?: string;
  agentId: string;
  disabled?: boolean;
  installed: InstalledSkill[];
  onInstalled: () => Promise<void>;
  onTry?: (skill: MarketplaceSkillDetail) => void;
}) {
  const { t, errorMessage } = useText();
  const [reload, setReload] = createSignal(0);
  let active = true;
  onSettled(() => () => {
    active = false;
  });
  const [state, setState] = createStore<{
    skills: MarketplaceSkillDetail[];
    selected: MarketplaceSkillDetail | null;
    loading: boolean;
    busy: boolean;
    error: string;
  }>({
    skills: [],
    selected: null,
    loading: true,
    busy: false,
    error: "",
  });
  createEffect(
    () => [props.agentId, reload(), props.initialSkillId] as const,
    () => {
      let disposed = false;
      setState((current) => ({ ...current, loading: true, error: "", selected: null }));
      void skillsPort()
        .skills.localList()
        .then(
          (skills) => {
            if (!disposed)
              setState((current) => ({
                ...current,
                skills,
                loading: false,
                selected: skills.find((skill) => skill.id === props.initialSkillId) ?? null,
              }));
          },
          () => {
            if (!disposed) setState((current) => ({ ...current, error: t("skill.local.loadFailed"), loading: false }));
          },
        );
      return () => {
        disposed = true;
      };
    },
  );
  const installed = () => props.installed.find((skill) => skill.skillId === state.selected?.id);
  async function toggleSkill(skill: MarketplaceSkillDetail, enabled: boolean) {
    if (state.busy || props.disabled) return;
    const agentId = props.agentId;
    const assigned = props.installed.find((item) => item.skillId === skill.id);
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      if (!assigned && enabled) {
        await skillsPort().skills.localInstall({ agentId, skillId: skill.id, revision: skill.version });
      } else if (assigned) {
        await skillsPort().skills.setEnabled({ agentId, skillId: skill.id, enabled });
      }
      if (active && props.agentId === agentId) await props.onInstalled();
    } catch (error) {
      if (active && props.agentId === agentId)
        setState((current) => ({
          ...current,
          error: errorMessage(error, t("skill.local.toggleFailed")),
        }));
    } finally {
      if (active && props.agentId === agentId) setState((current) => ({ ...current, busy: false }));
    }
  }
  async function install(skill: MarketplaceSkillDetail) {
    const agentId = props.agentId;
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      await skillsPort().skills.localInstall({ agentId, skillId: skill.id, revision: skill.version });
      if (!active || props.agentId !== agentId) return;
      await props.onInstalled();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: errorMessage(error, t("skill.local.addFailed")),
      }));
    } finally {
      setState((current) => ({ ...current, busy: false }));
    }
  }
  async function trySkill(skill: MarketplaceSkillDetail) {
    const agentId = props.agentId;
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      if (installed()?.enabled === false)
        await skillsPort().skills.setEnabled({ agentId, skillId: skill.id, enabled: true });
      if (!active || props.agentId !== agentId) return;
      await props.onInstalled();
      if (active && props.agentId === agentId && state.selected?.id === skill.id) props.onTry?.(skill);
    } catch {
      setState((current) => ({ ...current, error: t("skill.enableFailed") }));
    } finally {
      setState((current) => ({ ...current, busy: false }));
    }
  }
  return (
    <div class={["agent-local-library", state.selected && "agent-skill-detail"]}>
      <Show when={state.selected}>
        <div class="skill-preview-toolbar">
          <Show when={state.selected}>
            <Button variant="ghost" onClick={() => setState((current) => ({ ...current, selected: null, error: "" }))}>
              {t("skill.local.back")}
            </Button>
          </Show>
          <Show when={state.selected}>
            {(skill) => (
              <Button
                disabled={
                  state.busy ||
                  (installed()?.installedVersion === skill().version && installed()?.state !== "needs-repair")
                }
                onClick={() => void install(skill())}
              >
                {installed()?.state === "needs-repair"
                  ? t("skill.repair")
                  : installed()?.installedVersion === skill().version
                    ? t("skill.local.added")
                    : installed()
                      ? t("skill.update")
                      : t("skill.local.add")}
              </Button>
            )}
          </Show>
        </div>
      </Show>
      <Show when={state.error}>
        <p class="agent-memory-error" role="alert">
          {state.error}
        </p>
        <Show when={!state.selected}>
          <Button variant="ghost" onClick={() => setReload((value) => value + 1)}>
            {t("common.retry")}
          </Button>
        </Show>
      </Show>
      <Show
        when={!state.loading}
        fallback={
          <p role="status" class="agent-memory-state">
            {t("skill.local.loading")}
          </p>
        }
      >
        <Show
          when={state.selected}
          fallback={
            <>
              <Show when={state.skills.length === 0 && !state.error}>
                <p class="agent-memory-state">{t("skill.local.empty")}</p>
              </Show>
              <For each={state.skills}>
                {(skill) => (
                  <div
                    class={[
                      "agent-skill-row agent-local-skill-row",
                      !props.installed.some((item) => item.skillId === skill.id && item.enabled !== false) &&
                        "agent-skill-row-disabled",
                    ]}
                  >
                    <Button
                      variant="ghost"
                      class="agent-skill-open"
                      onClick={() => setState((current) => ({ ...current, selected: skill, error: "" }))}
                    >
                      <SkillGlyph iconUrl={skill.iconUrl} />
                      <span class="agent-skill-copy">
                        <span class="agent-skill-title">
                          <strong>{skill.name}</strong>
                        </span>
                        <small>{skill.description}</small>
                      </span>
                    </Button>
                    <Show
                      when={props.installed.some(
                        (item) =>
                          item.skillId === skill.id &&
                          item.installedVersion < skill.version &&
                          item.state !== "modified" &&
                          item.state !== "needs-repair",
                      )}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        class="agent-skill-update"
                        aria-label={t("skill.updateName", { name: skill.name })}
                        disabled={state.busy || props.disabled}
                        onClick={() => void install(skill)}
                      >
                        {t("skill.update")}
                      </Button>
                    </Show>
                    <Switch
                      aria-label={t("skill.enableName", { name: skill.name })}
                      checked={props.installed.some((item) => item.skillId === skill.id && item.enabled !== false)}
                      disabled={state.busy || props.disabled}
                      onChange={(enabled) => void toggleSkill(skill, enabled)}
                    />
                  </div>
                )}
              </For>
            </>
          }
        >
          {(skill) => (
            <SkillPreview
              skill={skill()}
              onTry={
                installed()?.installedVersion === skill().version &&
                installed()?.state !== "needs-repair" &&
                !state.busy &&
                props.onTry
                  ? () => void trySkill(skill())
                  : undefined
              }
              unavailableReason={
                !installed()
                  ? t("skill.unavailable.add")
                  : installed()?.installedVersion !== skill().version
                    ? t("skill.unavailable.updateRevision")
                    : installed()?.state === "needs-repair"
                      ? t("skill.unavailable.repair")
                      : t("skill.unavailable.composer")
              }
            />
          )}
        </Show>
      </Show>
    </div>
  );
}
