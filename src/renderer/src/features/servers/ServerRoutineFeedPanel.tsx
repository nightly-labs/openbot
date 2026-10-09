import type { RoutineFeed, RoutineFeedDesktopApi } from "@openbot/contracts/ipc";
import {
  Button,
  CalendarClock,
  CopyButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  RefreshCw,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  Text,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, Show, untrack } from "solid-js";
import type { ServerSettingsSectionHost } from "./server-settings-section";

export interface ServerRoutineFeedOptions {
  api: RoutineFeedDesktopApi;
  /** This computer's agents, for the filter. */
  listAgents: () => Promise<readonly { id: string; name: string }[]>;
}

/** The select value for the feed of every routine. An agent's value is `agent:<id>`, so it never collides. */
const ALL_AGENTS = "all";
const AGENT_PREFIX = "agent:";

/** Server Settings > Routines: the iCalendar feed of this computer's routines. */
export function ServerRoutineFeedPanel(
  props: ServerRoutineFeedOptions & Pick<ServerSettingsSectionHost, "busy" | "run" | "menuMount" | "showCopyError">,
) {
  const { t, errorMessage } = useText();
  const [feed, setFeed] = createSignal<RoutineFeed | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [agents, setAgents] = createSignal<readonly { id: string; name: string }[]>([]);
  const [agentId, setAgentId] = createSignal(ALL_AGENTS);

  // The panel mounts when the section opens, so each visit reads the feed again.
  untrack(() => {
    props.api.get().then(setFeed, (error) => setLoadError(errorMessage(error, t("server.settings.actionFailed"))));
    // Without names the filter has only "All"; the feed still works.
    props.listAgents().then(setAgents, () => undefined);
  });

  const url = () => {
    const base = feed()?.url;
    if (!base) return null;
    const value = agentId();
    return value === ALL_AGENTS ? base : `${base}?agent=${encodeURIComponent(value.slice(AGENT_PREFIX.length))}`;
  };
  const agentName = (value: string) =>
    value === ALL_AGENTS
      ? t("server.routineFeed.allAgents")
      : (agents().find((agent) => `${AGENT_PREFIX}${agent.id}` === value)?.name ?? "");
  const change = (key: string, action: () => Promise<RoutineFeed>) =>
    void props.run(key, async () => {
      setFeed(await action());
    });

  return (
    <SettingsSection title={t("server.routineFeed.title")}>
      <Show when={loadError()}>
        {(message) => (
          <Text variant="caption" tone="danger" role="alert">
            {message()}
          </Text>
        )}
      </Show>
      <Show when={feed()}>
        <ItemGroup class="settings-modal-card">
          <Show
            when={url()}
            fallback={
              <Item size="spacious">
                <ItemMedia>
                  <CalendarClock />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t("server.routineFeed.offTitle")}</ItemTitle>
                  <ItemDescription class="server-settings-routine-feed-text">
                    {t("server.routineFeed.offDescription")}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    size="sm"
                    loading={props.busy() === "routine-feed-create"}
                    disabled={Boolean(props.busy())}
                    onClick={() => change("routine-feed-create", props.api.create)}
                  >
                    {t("server.routineFeed.create")}
                  </Button>
                </ItemActions>
              </Item>
            }
          >
            {(value) => (
              <Item size="spacious">
                <ItemContent>
                  <div class="server-settings-routine-feed-row">
                    <Select<string>
                      class="server-settings-routine-feed-agent"
                      options={[ALL_AGENTS, ...agents().map((agent) => `${AGENT_PREFIX}${agent.id}`)]}
                      value={agentId()}
                      placement="bottom-start"
                      onChange={(value) => setAgentId(value ?? ALL_AGENTS)}
                      itemComponent={(item) => (
                        <SelectItem item={item.item}>{agentName(item.item.rawValue)}</SelectItem>
                      )}
                    >
                      <SelectTrigger size="sm" aria-label={t("server.routineFeed.agentLabel")}>
                        <SelectValue<string>>{(state) => agentName(state.selectedOption())}</SelectValue>
                      </SelectTrigger>
                      <SelectContent mount={props.menuMount()} />
                    </Select>
                    <Input
                      size="md"
                      readonly
                      aria-label={t("server.routineFeed.urlLabel")}
                      value={value()}
                      title={value()}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <CopyButton
                      value={value()}
                      label={t("server.routineFeed.copy")}
                      copiedLabel={t("common.copied")}
                      size="sm"
                      variant="default"
                      onCopyError={props.showCopyError}
                    />
                  </div>
                  <ItemDescription class="server-settings-routine-feed-text">
                    {t("server.routineFeed.privacy")}
                  </ItemDescription>
                  <div class="server-settings-routine-feed-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      title={t("server.routineFeed.regenerateLabel")}
                      loading={props.busy() === "routine-feed-create"}
                      disabled={Boolean(props.busy())}
                      onClick={() => change("routine-feed-create", props.api.create)}
                    >
                      <RefreshCw aria-hidden="true" />
                      {t("server.routineFeed.regenerate")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      loading={props.busy() === "routine-feed-remove"}
                      disabled={Boolean(props.busy())}
                      onClick={() => change("routine-feed-remove", props.api.remove)}
                    >
                      {t("server.routineFeed.turnOff")}
                    </Button>
                  </div>
                </ItemContent>
              </Item>
            )}
          </Show>
        </ItemGroup>
      </Show>
    </SettingsSection>
  );
}
