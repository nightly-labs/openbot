import type { InstalledSkill, MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import { createEffect, createSignal, createStore, For, onSettled, Show } from "solid-js";
import { SkillPreview } from "../../components/SkillPreview";
import { Button, Puzzle, Switch } from "../../components/ui";

export function LocalSkillsLibrary(props: {
  agentId: string;
  disabled?: boolean;
  installed: InstalledSkill[];
  onInstalled: () => Promise<void>;
  onTry?: (skill: MarketplaceSkillDetail) => void;
}) {
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
    () => [props.agentId, reload()] as const,
    () => {
      let disposed = false;
      setState((current) => ({ ...current, loading: true, error: "", selected: null }));
      void window.openbot.skills.localList().then(
        (skills) => {
          if (!disposed) setState((current) => ({ ...current, skills, loading: false }));
        },
        () => {
          if (!disposed) setState((current) => ({ ...current, error: "Could not load local skills.", loading: false }));
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
        await window.openbot.skills.localInstall({ agentId, skillId: skill.id, revision: skill.version });
      } else if (assigned) {
        await window.openbot.skills.setEnabled({ agentId, skillId: skill.id, enabled });
      }
      if (active && props.agentId === agentId) await props.onInstalled();
    } catch (error) {
      if (active && props.agentId === agentId)
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Could not change the skill state.",
        }));
    } finally {
      if (active && props.agentId === agentId) setState((current) => ({ ...current, busy: false }));
    }
  }
  async function install(skill: MarketplaceSkillDetail) {
    const agentId = props.agentId;
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      await window.openbot.skills.localInstall({ agentId, skillId: skill.id, revision: skill.version });
      if (!active || props.agentId !== agentId) return;
      await props.onInstalled();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Could not add the local skill.",
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
        await window.openbot.skills.setEnabled({ agentId, skillId: skill.id, enabled: true });
      if (!active || props.agentId !== agentId) return;
      await props.onInstalled();
      if (active && props.agentId === agentId && state.selected?.id === skill.id) props.onTry?.(skill);
    } catch {
      setState((current) => ({ ...current, error: "Could not enable the skill." }));
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
              Back to local skills
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
                  ? "Repair"
                  : installed()?.installedVersion === skill().version
                    ? "Added"
                    : installed()
                      ? "Update"
                      : "Add skill"}
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
            Retry
          </Button>
        </Show>
      </Show>
      <Show when={!state.loading} fallback={<p role="status">Loading local skills…</p>}>
        <Show
          when={state.selected}
          fallback={
            <>
              <Show when={state.skills.length === 0 && !state.error}>
                <p>No local skills yet.</p>
              </Show>
              <For each={state.skills}>
                {(skill) => (
                  <div class="agent-local-skill-row">
                    <Button
                      variant="ghost"
                      class="agent-skill-open"
                      onClick={() => setState((current) => ({ ...current, selected: skill, error: "" }))}
                    >
                      <span class="agent-skill-icon" aria-hidden="true">
                        <Show when={skill.iconUrl} fallback={<Puzzle />}>
                          {(url) => <img src={url()} alt="" />}
                        </Show>
                      </span>
                      <span class="agent-skill-copy">
                        <span class="agent-skill-title">
                          <strong>{skill.name}</strong>
                        </span>
                        <small>{skill.description}</small>
                      </span>
                    </Button>
                    <Switch
                      aria-label={`Enable ${skill.name}`}
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
                  ? "Add this skill to try it."
                  : installed()?.installedVersion !== skill().version
                    ? "Update this skill to try this revision."
                    : installed()?.state === "needs-repair"
                      ? "Repair this skill to try it."
                      : "The agent composer is unavailable."
              }
            />
          )}
        </Show>
      </Show>
    </div>
  );
}
