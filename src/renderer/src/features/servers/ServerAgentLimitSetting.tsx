import type { HostAgentLimitSettings, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { Input, Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show, untrack } from "solid-js";

export type HostAgentLimitCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getAgentLimit" | "setAgentLimit">;

export interface ServerAgentLimitOptions {
  calls?: HostAgentLimitCalls;
}

const lastSettings = new Map<string, HostAgentLimitSettings>();

export function ServerAgentLimitSetting(
  props: ServerAgentLimitOptions & {
    serverId: string;
    disabled: boolean;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage, format } = useText();
  const calls = (): HostAgentLimitCalls => props.calls ?? window.openbot.hostAdmin;
  const [settings, setSettings] = createSignal<HostAgentLimitSettings | null>(null);
  const [draft, setDraft] = createSignal("");
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [fieldError, setFieldError] = createSignal<string | null>(null);
  let generation = 0;

  function adopt(next: HostAgentLimitSettings | null): void {
    setFieldError(null);
    setDraft(next?.limit == null ? "" : `${next.limit}`);
  }

  createEffect(
    () => props.serverId,
    (serverId) => {
      const current = ++generation;
      const cached = lastSettings.get(serverId) ?? null;
      setSettings(cached);
      adopt(cached);
      setLoadError(null);
      untrack(calls)
        .getAgentLimit(serverId)
        .then(
          (next) => {
            if (current !== generation) return;
            lastSettings.set(serverId, next);
            setSettings(next);
            adopt(next);
          },
          (error: unknown) => {
            if (current === generation) {
              lastSettings.delete(serverId);
              setSettings(null);
              setLoadError(errorMessage(error, t("server.settings.agentLimitLoadFailed")));
            }
          },
        );
    },
  );

  function commit(): void {
    const current = settings();
    if (!current) return;
    const text = draft().trim();
    const parsed = text === "" ? null : Number(text);
    if (parsed !== null && (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > current.maxLimit)) {
      setFieldError(t("server.settings.agentLimitInvalid", { max: format.number(current.maxLimit) }));
      return;
    }
    setFieldError(null);
    if (parsed === current.limit) return;
    const serverId = props.serverId;
    const request = ++generation;
    void props.run("agentLimit", async () => {
      const next = await calls().setAgentLimit(parsed, serverId);
      lastSettings.set(serverId, next);
      if (request === generation) {
        setSettings(next);
        adopt(next);
      }
    });
  }

  return (
    <Item>
      <ItemContent>
        <ItemTitle id="server-settings-agent-limit-label">{t("server.settings.agentLimit")}</ItemTitle>
        <ItemDescription>{loadError() ?? t("server.settings.agentLimitDescription")}</ItemDescription>
      </ItemContent>
      <Show when={settings()}>
        {(current) => (
          <ItemActions data-invalid={fieldError() ? "" : undefined}>
            <Input
              id="server-settings-agent-limit"
              class="settings-agent-limit-input"
              type="number"
              inputmode="numeric"
              min={1}
              max={current().maxLimit}
              step={1}
              value={draft()}
              placeholder={t("server.settings.agentLimitDefault", { count: current().defaultLimit })}
              disabled={props.disabled}
              aria-labelledby="server-settings-agent-limit-label"
              aria-invalid={fieldError() ? "true" : undefined}
              onValueChange={setDraft}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.isComposing) return;
                event.preventDefault();
                commit();
              }}
            />
            <span
              class="ui-field-error settings-agent-limit-error"
              role="alert"
              aria-hidden={fieldError() ? undefined : "true"}
            >
              {fieldError() ?? ""}
            </span>
          </ItemActions>
        )}
      </Show>
    </Item>
  );
}
