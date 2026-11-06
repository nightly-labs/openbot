import {
  REMOTE_CONTROL_ACCESS_LEVELS,
  type RemoteControlAccess,
  type RemoteControlPolicy,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SwitchField,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createStore, onSettled, Show } from "solid-js";
import { serversPort } from "./servers-port";

const ACCESS_LABELS = {
  owner: "server.desktop.accessOwner",
  admins: "server.desktop.accessAdmins",
  members: "server.desktop.accessMembers",
} as const satisfies Record<RemoteControlAccess, AppTextKey>;

interface PolicyState {
  policy: RemoteControlPolicy | null;
  busy: boolean;
  error: string | null;
}

/**
 * Server Settings > Remote desktop of this computer: who may control it, whether the person at it
 * must allow each session, and the way to end every session that runs now.
 */
export function RemoteControlPolicySection(props: { activeSessions: number; menuMount: HTMLElement | undefined }) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<PolicyState>({ policy: null, busy: false, error: null });

  onSettled(() => {
    serversPort()
      .host.getRemoteControlPolicy()
      .then(
        (policy) =>
          setState((draft) => {
            draft.policy = policy;
          }),
        (error: unknown) =>
          setState((draft) => {
            draft.error = errorMessage(error, t("server.desktop.policyLoadFailed"));
          }),
      );
  });

  async function run(action: () => Promise<void>, fallback: AppTextKey): Promise<void> {
    setState((draft) => {
      draft.busy = true;
      draft.error = null;
    });
    try {
      await action();
    } catch (error) {
      setState((draft) => {
        draft.error = errorMessage(error, t(fallback));
      });
    } finally {
      setState((draft) => {
        draft.busy = false;
      });
    }
  }

  function save(change: Partial<RemoteControlPolicy>): void {
    const current = state.policy;
    if (!current) return;
    void run(async () => {
      const saved = await serversPort().host.setRemoteControlPolicy({ ...current, ...change });
      setState((draft) => {
        draft.policy = saved;
      });
    }, "server.desktop.policySaveFailed");
  }

  return (
    <>
      <Show when={state.error}>
        <Alert tone="warning" role="alert">
          <AlertContent>
            <AlertDescription>{state.error}</AlertDescription>
          </AlertContent>
        </Alert>
      </Show>
      <ItemGroup class="settings-modal-card">
        <Show when={state.policy}>
          {(policy) => (
            <>
              <Item>
                <ItemContent>
                  <ItemTitle id="server-settings-remote-control-access-label">
                    {t("server.desktop.accessLabel")}
                  </ItemTitle>
                  <ItemDescription>{t("server.desktop.accessDescription")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Select<RemoteControlAccess>
                    options={[...REMOTE_CONTROL_ACCESS_LEVELS]}
                    value={policy().access}
                    disabled={state.busy}
                    placement="bottom-end"
                    onChange={(access) => {
                      if (access && access !== policy().access) save({ access });
                    }}
                    itemComponent={(item) => (
                      <SelectItem item={item.item}>{t(ACCESS_LABELS[item.item.rawValue])}</SelectItem>
                    )}
                  >
                    <SelectTrigger size="sm" aria-labelledby="server-settings-remote-control-access-label">
                      <SelectValue<RemoteControlAccess>>
                        {(select) => {
                          const access = select.selectedOption();
                          return access ? t(ACCESS_LABELS[access]) : "";
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent mount={props.menuMount} />
                  </Select>
                </ItemActions>
              </Item>
              <SwitchField
                checked={policy().askOnHost}
                disabled={state.busy}
                onChange={(askOnHost) => save({ askOnHost })}
                label={t("server.desktop.askLabel")}
                description={t("server.desktop.askDescription")}
              />
            </>
          )}
        </Show>
        <Show when={props.activeSessions > 0}>
          <Item>
            <ItemContent>
              <ItemTitle>{t("server.desktop.activeTitle", { active: props.activeSessions })}</ItemTitle>
              <ItemDescription>{t("server.desktop.activeDescription")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={state.busy}
                onClick={() =>
                  void run(async () => {
                    await serversPort().host.stopRemoteControl();
                  }, "server.desktop.stopFailed")
                }
              >
                {t("server.desktop.stopAll")}
              </Button>
            </ItemActions>
          </Item>
        </Show>
      </ItemGroup>
    </>
  );
}
