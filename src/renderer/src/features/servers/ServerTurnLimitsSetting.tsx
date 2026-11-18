import {
  HOST_AGENT_TASK_LIMIT_MAX,
  HOST_TURN_LIMIT_MAX,
  type HostTurnLimit,
  type HostTurnLimits,
  type HostTurnLimitsInput,
  type OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
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

/** The turn limit calls of one server's host. The desktop reaches them through main. */
export type HostTurnLimitsCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getTurnLimits" | "setTurnLimits">;

export interface ServerTurnLimitsOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostTurnLimitsCalls;
}

/** `default`, then each limit as text, because a select keys its options by value. */
type LimitChoice = "default" | `${number}`;
type TurnLimitChoice = LimitChoice | "unlimited";

// Constant arrays: a select that gets a new options array at each change does not stop updating.
// Doubling steps up to the host maximum. The host still takes any value from 1 to the maximum, and the
// trigger shows a saved value that is not a step.
const TURN_LIMIT_CHOICES: TurnLimitChoice[] = [
  "default",
  "unlimited",
  "1",
  "2",
  "4",
  "8",
  "16",
  "32",
  "64",
  `${HOST_TURN_LIMIT_MAX}`,
];
const AGENT_TASK_LIMIT_CHOICES: LimitChoice[] = [
  "default",
  "1",
  "2",
  "4",
  "8",
  "16",
  "32",
  `${HOST_AGENT_TASK_LIMIT_MAX}`,
];

const turnLimitChoice = (limit: HostTurnLimit | null): TurnLimitChoice => (limit === null ? "default" : `${limit}`);
const agentTaskLimitChoice = (limit: number | null): LimitChoice => (limit === null ? "default" : `${limit}`);
const turnLimitOf = (choice: TurnLimitChoice): HostTurnLimit | null =>
  choice === "default" ? null : choice === "unlimited" ? choice : Number(choice);
const agentTaskLimitOf = (choice: LimitChoice): number | null => (choice === "default" ? null : Number(choice));

/**
 * The last value that this window read for each server. The rows show it at once when the settings
 * open again, so the rows do not change their size when the host answers.
 */
const lastSettings = new Map<string, HostTurnLimits>();

/**
 * Server Settings > General: how many agent threads run at the same time on the host, and how many
 * each agent runs when it has no limit of its own (`host-turn-limits-v1`). The host checks the role
 * again.
 */
export function ServerTurnLimitsSetting(
  props: ServerTurnLimitsOptions & {
    serverId: string;
    disabled: boolean;
    menuMount: HTMLElement | undefined;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage, format } = useText();
  const calls = (): HostTurnLimitsCalls => props.calls ?? window.openbot.hostAdmin;
  const [settings, setSettings] = createSignal<HostTurnLimits | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  /**
   * False until the host answers. A save sends both values, so a value from an earlier open must not
   * overwrite a change that another admin made since.
   */
  const [loaded, setLoaded] = createSignal(false);
  /** Bumped for each server and each change, so an earlier answer is dropped. */
  let generation = 0;

  createEffect(
    () => props.serverId,
    (serverId) => {
      const current = ++generation;
      setSettings(lastSettings.get(serverId) ?? null);
      setLoadError(null);
      setLoaded(false);
      untrack(calls)
        .getTurnLimits(serverId)
        .then(
          (next) => {
            if (current !== generation) return;
            lastSettings.set(serverId, next);
            setSettings(next);
            setLoaded(true);
          },
          (error: unknown) => {
            if (current === generation) {
              lastSettings.delete(serverId);
              setSettings(null);
              setLoadError(errorMessage(error, t("server.settings.turnLimitsLoadFailed")));
            }
          },
        );
    },
  );

  function save(change: Partial<HostTurnLimitsInput>): void {
    const current = settings();
    if (!current) return;
    const input: HostTurnLimitsInput = {
      turnLimit: current.turnLimit,
      agentTaskLimit: current.agentTaskLimit,
      ...change,
    };
    if (input.turnLimit === current.turnLimit && input.agentTaskLimit === current.agentTaskLimit) return;
    const serverId = props.serverId;
    const request = ++generation;
    void props.run("turnLimits", async () => {
      const next = await calls().setTurnLimits(input, serverId);
      lastSettings.set(serverId, next);
      if (request === generation) setSettings(next);
    });
  }

  const turnLimitLabel = (choice: TurnLimitChoice) => {
    if (choice === "unlimited") return t("server.settings.turnLimitUnlimited");
    if (choice !== "default") return format.number(Number(choice));
    const automatic = settings()?.automaticTurnLimit ?? null;
    return automatic === null
      ? t("server.settings.turnLimitAutomaticUnlimited")
      : t("server.settings.turnLimitAutomatic", { count: automatic });
  };
  const agentTaskLimitLabel = (choice: LimitChoice) =>
    choice === "default"
      ? t("server.settings.agentTaskLimitDefault", { count: settings()?.defaultAgentTaskLimit ?? 0 })
      : format.number(Number(choice));

  return (
    <>
      <Item>
        <ItemContent>
          <ItemTitle id="server-settings-turn-limit-label">{t("server.settings.turnLimit")}</ItemTitle>
          <ItemDescription>{loadError() ?? t("server.settings.turnLimitDescription")}</ItemDescription>
        </ItemContent>
        <Show when={settings()}>
          {(current) => (
            <ItemActions>
              <Select<TurnLimitChoice>
                class="settings-modal-select"
                options={TURN_LIMIT_CHOICES}
                value={turnLimitChoice(current().turnLimit)}
                disabled={props.disabled || !loaded()}
                placement="bottom-end"
                onChange={(next) => {
                  if (next) save({ turnLimit: turnLimitOf(next) });
                }}
                itemComponent={(item) => <SelectItem item={item.item}>{turnLimitLabel(item.item.rawValue)}</SelectItem>}
              >
                <SelectTrigger size="sm" aria-labelledby="server-settings-turn-limit-label">
                  <SelectValue<TurnLimitChoice>>
                    {() => turnLimitLabel(turnLimitChoice(current().turnLimit))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.menuMount} />
              </Select>
            </ItemActions>
          )}
        </Show>
      </Item>
      <Show when={settings()}>
        {(current) => (
          <Item>
            <ItemContent>
              <ItemTitle id="server-settings-agent-task-limit-label">{t("server.settings.agentTaskLimit")}</ItemTitle>
              <ItemDescription>{t("server.settings.agentTaskLimitDescription")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select<LimitChoice>
                class="settings-modal-select"
                options={AGENT_TASK_LIMIT_CHOICES}
                value={agentTaskLimitChoice(current().agentTaskLimit)}
                disabled={props.disabled || !loaded()}
                placement="bottom-end"
                onChange={(next) => {
                  if (next) save({ agentTaskLimit: agentTaskLimitOf(next) });
                }}
                itemComponent={(item) => (
                  <SelectItem item={item.item}>{agentTaskLimitLabel(item.item.rawValue)}</SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-labelledby="server-settings-agent-task-limit-label">
                  <SelectValue<LimitChoice>>
                    {() => agentTaskLimitLabel(agentTaskLimitChoice(current().agentTaskLimit))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.menuMount} />
              </Select>
            </ItemActions>
          </Item>
        )}
      </Show>
    </>
  );
}
