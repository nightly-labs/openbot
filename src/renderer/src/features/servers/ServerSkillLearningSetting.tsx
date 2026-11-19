import { type HostSkillLearning, isSkillLearningMode, type OpenBotDesktopApi } from "@openbot/contracts/ipc";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show, untrack } from "solid-js";

/** The skill learning calls of one server's host. The desktop reaches them through main. */
export type HostSkillLearningCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getSkillLearning" | "setSkillLearning">;

export interface ServerSkillLearningOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostSkillLearningCalls;
}

/**
 * The last value that this window read for each server. The row shows it at once when the settings
 * open again, so the row does not change its size when the host answers.
 */
const lastSettings = new Map<string, HostSkillLearning>();

/**
 * Server Settings > General: whether the memory review of the agents of this computer or a joined
 * server saves the skills it learns, asks first, or does not look for skills (`skill-learning-v1`).
 * The values come from the host. The host checks the role again.
 */
export function ServerSkillLearningSetting(
  props: ServerSkillLearningOptions & {
    serverId: string;
    disabled: boolean;
    menuMount: HTMLElement | undefined;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage } = useText();
  const calls = (): HostSkillLearningCalls => props.calls ?? window.openbot.hostAdmin;
  const [settings, setSettings] = createSignal<HostSkillLearning | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  /** Bumped for each server and each change, so an earlier answer is dropped. */
  let generation = 0;

  createEffect(
    () => props.serverId,
    (serverId) => {
      const current = ++generation;
      setSettings(lastSettings.get(serverId) ?? null);
      setLoadError(null);
      untrack(calls)
        .getSkillLearning(serverId)
        .then(
          (next) => {
            if (current !== generation) return;
            lastSettings.set(serverId, next);
            setSettings(next);
          },
          (error: unknown) => {
            if (current === generation) {
              lastSettings.delete(serverId);
              setSettings(null);
              setLoadError(errorMessage(error, t("server.settings.skillLearningLoadFailed")));
            }
          },
        );
    },
  );

  /** A newer host can send a mode that this client does not know; it shows the raw value. */
  function label(mode: string | null): string {
    if (mode === null) return "";
    if (!isSkillLearningMode(mode)) return mode;
    if (mode === "automatic") return t("server.settings.skillLearningAutomatic");
    if (mode === "ask") return t("server.settings.skillLearningAsk");
    return t("server.settings.skillLearningOff");
  }

  function choose(mode: string | null): void {
    const current = settings();
    if (mode === null || !current || mode === current.mode) return;
    const serverId = props.serverId;
    const request = ++generation;
    void props.run("skillLearning", async () => {
      const next = await calls().setSkillLearning(mode, serverId);
      lastSettings.set(serverId, next);
      if (request === generation) setSettings(next);
    });
  }

  return (
    <Item>
      <ItemContent>
        <ItemTitle id="server-settings-skill-learning-label">{t("server.settings.skillLearning")}</ItemTitle>
        <ItemDescription>{loadError() ?? t("server.settings.skillLearningDescription")}</ItemDescription>
      </ItemContent>
      <Show when={settings()}>
        {(current) => (
          <ItemActions>
            <Select<string>
              class="settings-modal-select"
              // A host that no longer permits its stored value still shows it.
              options={
                current().choices.includes(current().mode) ? current().choices : [current().mode, ...current().choices]
              }
              value={current().mode}
              disabled={props.disabled}
              placement="bottom-end"
              onChange={choose}
              itemComponent={(item) => <SelectItem item={item.item}>{label(item.item.rawValue)}</SelectItem>}
            >
              <SelectTrigger size="sm" aria-labelledby="server-settings-skill-learning-label">
                <SelectValue<string>>{(state) => label(state.selectedOption() ?? null)}</SelectValue>
              </SelectTrigger>
              <SelectContent mount={props.menuMount} />
            </Select>
          </ItemActions>
        )}
      </Show>
    </Item>
  );
}
