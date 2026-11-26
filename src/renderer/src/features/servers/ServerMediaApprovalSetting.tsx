import { isMediaApprovalCredits, type MediaApprovalCreditsUpdate } from "@openbot/contracts/ipc";
import { Input, Item, ItemActions, ItemContent, ItemDescription, ItemTitle, Switch } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show, untrack } from "solid-js";
import {
  forgetMediaApprovalCredits,
  type HostMediaApprovalCreditsCalls,
  loadMediaApprovalCredits,
  mediaApprovalCredits,
  saveMediaApprovalCredits,
} from "./media-approval-credits-store";

export type { HostMediaApprovalCreditsCalls } from "./media-approval-credits-store";

export interface ServerMediaApprovalOptions {
  calls?: HostMediaApprovalCreditsCalls;
}

function creditsOf(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const credits = Number(trimmed);
  return isMediaApprovalCredits(credits) ? credits : null;
}

export function ServerMediaApprovalSetting(
  props: ServerMediaApprovalOptions & {
    serverId: string;
    disabled: boolean;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage } = useText();
  const calls = (): HostMediaApprovalCreditsCalls => props.calls ?? window.openbot.hostAdmin;
  const settings = () => mediaApprovalCredits(props.serverId);
  const [draft, setDraft] = createSignal<string | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const shownCredits = () => draft() ?? String(settings()?.credits ?? "");

  createEffect(
    () => props.serverId,
    (serverId) => {
      setDraft(null);
      setLoadError(null);
      loadMediaApprovalCredits(serverId, untrack(calls)).catch((error: unknown) => {
        if (untrack(() => props.serverId) !== serverId) return;
        forgetMediaApprovalCredits(serverId);
        setLoadError(errorMessage(error, t("server.settings.mediaApprovalCreditsLoadFailed")));
      });
    },
  );

  function save(key: string, update: MediaApprovalCreditsUpdate): void {
    const serverId = props.serverId;
    void props.run(key, async () => {
      await saveMediaApprovalCredits(serverId, update, calls());
    });
  }

  function commit(): void {
    const current = settings();
    const credits = creditsOf(shownCredits());
    setDraft(null);
    if (!current || credits === null || credits === current.credits) return;
    save("mediaApprovalCredits", { credits });
  }

  return (
    <>
      <Item>
        <ItemContent>
          <ItemTitle id="server-settings-media-approval-agents-label">
            {t("server.settings.mediaApprovalAgents")}
          </ItemTitle>
          <Show when={loadError()}>{(error) => <ItemDescription>{error()}</ItemDescription>}</Show>
        </ItemContent>
        <Show when={settings()}>
          {(current) => (
            <ItemActions>
              <Switch
                checked={current().agents}
                disabled={props.disabled}
                onChange={(agents: boolean) => save("mediaApprovalAgents", { agents })}
                aria-labelledby="server-settings-media-approval-agents-label"
              />
            </ItemActions>
          )}
        </Show>
      </Item>
      <Show when={settings()?.agents !== false}>
        <Item>
          <ItemContent>
            <ItemTitle id="server-settings-media-approval-credits-label">
              {t("server.settings.mediaApprovalCredits")}
            </ItemTitle>
          </ItemContent>
          <Show when={settings()}>
            <ItemActions class="server-settings-credits-field">
              <Input
                size="sm"
                type="text"
                inputmode="numeric"
                class="server-settings-credits-input"
                aria-labelledby="server-settings-media-approval-credits-label"
                invalid={creditsOf(shownCredits()) === null}
                disabled={props.disabled}
                value={shownCredits()}
                onValueChange={setDraft}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <span>{t("server.settings.mediaApprovalCreditsUnit")}</span>
            </ItemActions>
          </Show>
        </Item>
      </Show>
      <Item>
        <ItemContent>
          <ItemTitle id="server-settings-media-approval-ask-label">{t("server.settings.mediaApprovalAsk")}</ItemTitle>
        </ItemContent>
        <Show when={settings()}>
          {(current) => (
            <ItemActions>
              <Switch
                checked={current().askWhenBlocked}
                disabled={props.disabled}
                onChange={(askWhenBlocked: boolean) => save("mediaApprovalAsk", { askWhenBlocked })}
                aria-labelledby="server-settings-media-approval-ask-label"
              />
            </ItemActions>
          )}
        </Show>
      </Item>
    </>
  );
}
