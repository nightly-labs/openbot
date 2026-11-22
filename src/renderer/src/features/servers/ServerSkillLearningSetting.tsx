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

export type HostSkillLearningCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getSkillLearning" | "setSkillLearning">;

export interface ServerSkillLearningOptions {
  calls?: HostSkillLearningCalls;
}

const lastSettings = new Map<string, HostSkillLearning>();

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
