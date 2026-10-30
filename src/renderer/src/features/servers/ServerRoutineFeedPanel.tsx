import type { RoutineFeed, RoutineFeedDesktopApi } from "@openbot/contracts/ipc";
import {
  Button,
  CalendarClock,
  ConfirmDialog,
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
  Spinner,
  Text,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, createStore, Show, untrack } from "solid-js";
import type { ServerSettingsSectionHost } from "./server-settings-section";

export interface ServerRoutineFeedOptions {
  api: RoutineFeedDesktopApi;
  /** This computer's agents, for the filter. */
  listAgents: () => Promise<readonly { id: string; name: string }[]>;
}

/** The select value for the feed of every routine. An agent's value is `agent:<id>`, so it never collides. */
const ALL_AGENTS = "all";
const AGENT_PREFIX = "agent:";

/** Both actions stop the current URL, so each one asks first. */
type FeedConfirm = "regenerate" | "turnOff";

/** Server Settings > Routines: the iCalendar feed of this computer's routines. */
export function ServerRoutineFeedPanel(
  props: ServerRoutineFeedOptions & Pick<ServerSettingsSectionHost, "busy" | "run" | "menuMount" | "showCopyError">,
) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{
    feed: RoutineFeed | null;
    loading: boolean;
    loadError: string | null;
    agents: readonly { id: string; name: string }[];
    agentsFailed: boolean;
  }>({ feed: null, loading: true, loadError: null, agents: [], agentsFailed: false });
  const [agentId, setAgentId] = createSignal(ALL_AGENTS);
  const [confirm, setConfirm] = createSignal<FeedConfirm | null>(null);

  const read = () => {
    props.api.get().then(
      (feed) =>
        setState((current) => {
          current.feed = feed;
          current.loading = false;
        }),
      (error) =>
        setState((current) => {
          current.loadError = errorMessage(error, t("server.settings.actionFailed"));
          current.loading = false;
        }),
    );
    // Without names the filter has only "All"; the feed still works, and a caption says why.
    props.listAgents().then(
      (agents) =>
        setState((current) => {
          current.agents = agents;
          current.agentsFailed = false;
        }),
      () =>
        setState((current) => {
          current.agentsFailed = true;
        }),
    );
  };
  const retry = () => {
    setState((current) => {
      current.loading = true;
      current.loadError = null;
    });
    read();
  };

  // The panel mounts when the section opens, so each visit reads the feed again.
  untrack(read);

  const url = () => {
    const base = state.feed?.url;
    if (!base) return null;
    const value = agentId();
    return value === ALL_AGENTS ? base : `${base}?agent=${encodeURIComponent(value.slice(AGENT_PREFIX.length))}`;
  };
  const agentName = (value: string) =>
    value === ALL_AGENTS
      ? t("server.routineFeed.allAgents")
      : (state.agents.find((agent) => `${AGENT_PREFIX}${agent.id}` === value)?.name ?? "");
  const change = (key: string, action: () => Promise<RoutineFeed>) =>
    props.run(key, async () => {
      const feed = await action();
      setState((current) => {
        current.feed = feed;
      });
    });
  // A failure shows as a toast and keeps the dialog open, so the user can try again or cancel.
  const confirmChange = async (key: string, action: () => Promise<RoutineFeed>) => {
    if (await change(key, action)) setConfirm(null);
  };

  return (
    <SettingsSection title={t("server.routineFeed.title")}>
      <Show when={state.loading}>
        <div class="server-settings-routine-feed-loading">
          <Spinner label={t("server.routineFeed.loading")} />
        </div>
      </Show>
      <Show when={state.loadError}>
        {(message) => (
          <div class="server-settings-routine-feed-error">
            <Text variant="caption" tone="danger" role="alert">
              {message()}
            </Text>
            <Button type="button" size="sm" variant="outline" onClick={retry}>
              {t("common.retry")}
            </Button>
          </div>
        )}
      </Show>
      <Show when={state.feed}>
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
                    onClick={() => void change("routine-feed-create", props.api.create)}
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
                      options={[ALL_AGENTS, ...state.agents.map((agent) => `${AGENT_PREFIX}${agent.id}`)]}
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
                  <Show when={state.agentsFailed}>
                    <Text variant="caption" tone="muted">
                      {t("server.routineFeed.agentsLoadFailed")}
                    </Text>
                  </Show>
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
                      onClick={() => setConfirm("regenerate")}
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
                      onClick={() => setConfirm("turnOff")}
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
      <ConfirmDialog
        open={confirm() === "regenerate"}
        tone="default"
        icon={<RefreshCw />}
        initialFocus="cancel"
        pending={props.busy() === "routine-feed-create"}
        title={t("server.routineFeed.regenerateTitle")}
        description={t("server.routineFeed.regenerateDescription")}
        confirmLabel={t("server.routineFeed.regenerateConfirm")}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirmChange("routine-feed-create", props.api.create)}
      />
      <ConfirmDialog
        open={confirm() === "turnOff"}
        initialFocus="cancel"
        pending={props.busy() === "routine-feed-remove"}
        title={t("server.routineFeed.turnOffTitle")}
        description={t("server.routineFeed.turnOffDescription")}
        confirmLabel={t("server.routineFeed.turnOff")}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirmChange("routine-feed-remove", props.api.remove)}
      />
    </SettingsSection>
  );
}
