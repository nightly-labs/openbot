import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { canAdministerServer, type MarketplaceAgentDetail, type MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import { useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import X from "lucide-react-native/icons/x";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { loadMarketplaceAgent, loadMarketplaceSkill } from "../api/marketplace-catalog";
import {
  HeroChips,
  HeroRequest,
  ListingBlock,
  ListingFacts,
  ListingHeader,
  ListingHeaderAction,
  TryPressable,
} from "../components/listing-sheet-parts";
import {
  agentListing,
  appListings,
  CATEGORY_LABELS,
  type MarketplaceListing,
  skillListing,
} from "../model/marketplace-listings";
import type { MobilePlugin } from "../model/plugin-catalog.generated";
import { pluginConnectMethod, pluginServerId } from "../model/plugin-connect";
import { useMarketplaceInstalled } from "../model/use-marketplace";
import { usePluginConnect } from "../model/use-plugin-connect";
import { useTryInChat } from "../model/use-try-in-chat";

/**
 * The page of one listing, as a sheet over the Marketplace. It shows what the listing is, as the
 * desktop page does; the `+` in the header installs it. A skill and an app that asks for a key or a
 * sign-in open the next page of the same sheet for that step.
 */
export function MarketplaceListingScreen() {
  const { t, errorMessage } = useText();
  const { serverId, kind, id, name } = useLocalSearchParams<{
    serverId: string;
    kind: string;
    id: string;
    name?: string;
  }>();
  const { session } = useMobileSession();
  const apiUrl = session?.apiUrl ?? null;
  const agent = useQuery({
    queryKey: queryKeys.marketplace(apiUrl, "agent", id),
    enabled: apiUrl !== null && kind === "agent",
    retry: false,
    queryFn: ({ signal }) => loadMarketplaceAgent(apiUrl ?? "", id, signal),
  });
  const skill = useQuery({
    queryKey: queryKeys.marketplace(apiUrl, "skill", id),
    enabled: apiUrl !== null && kind === "skill",
    retry: false,
    queryFn: ({ signal }) => loadMarketplaceSkill(apiUrl ?? "", id, signal),
  });
  const app = apiUrl && kind === "app" ? appListings(apiUrl).find((item) => item.id === id) : undefined;
  const [busy, setBusy] = useState(false);
  // The host may already install it. The sheet stays until the request settles.
  usePreventRemove(busy, () => undefined);
  const close = () => {
    if (router.canGoBack()) router.back();
  };

  const query = kind === "agent" ? agent : kind === "skill" ? skill : null;
  let body: ReactNode;
  if (kind === "app")
    body =
      app?.kind === "app" ? (
        <AppPage serverId={serverId} listing={app} plugin={app.plugin} onBusy={setBusy} />
      ) : (
        <SettingsNote>{t("mobile.marketplace.listing.notFound")}</SettingsNote>
      );
  else if (!apiUrl || !query) body = <SettingsNote>{t("mobile.marketplace.listing.notFound")}</SettingsNote>;
  else if (query.isPending) body = <Spinner className="mt-10 self-center" />;
  else if (query.isError)
    body = (
      <View className="items-center gap-3 pt-6">
        <Typography.Paragraph align="center" className="text-grouped-secondary">
          {errorMessage(query.error, t("mobile.marketplace.loadFailed"))}
        </Typography.Paragraph>
        <Button variant="secondary" onPress={() => void query.refetch()}>
          <Button.Label>{t("common.tryAgain")}</Button.Label>
        </Button>
      </View>
    );
  else if (agent.data)
    body = (
      <AgentPage serverId={serverId} listing={agentListing(apiUrl, agent.data)} detail={agent.data} onBusy={setBusy} />
    );
  else if (skill.data)
    body = <SkillPage serverId={serverId} listing={skillListing(apiUrl, skill.data)} detail={skill.data} />;

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-6 px-5 pb-safe-offset-5 pt-5"
      contentInsetAdjustmentBehavior="automatic"
    >
      {/* The name from the row, from the first frame; the loaded listing sets the same title. */}
      <Stack.Screen options={{ title: name ?? "" }} />
      {isAndroid ? (
        <AndroidHeaderButton
          placement="left"
          icon={X}
          accessibilityLabel={t("common.close")}
          disabled={busy}
          onPress={close}
        />
      ) : (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            icon={isIOS ? "xmark" : undefined}
            accessibilityLabel={t("common.close")}
            disabled={busy}
            onPress={close}
          >
            {isIOS ? t("common.close") : "×"}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      {body}
    </SheetScrollView>
  );
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
      {error}
    </Typography.Paragraph>
  ) : null;
}

/** Why the user cannot install here: a member, or a server that is offline or too old for the route. */
function useInstallBlock(serverId: string, allowed: boolean): string | null {
  const { t } = useText();
  const role = useMobileWorkspaceSelector((workspace) => workspace.servers.find((item) => item.id === serverId)?.role);
  if (allowed) return null;
  return canAdministerServer(role)
    ? t("mobile.marketplace.permission.unavailable")
    : t("mobile.marketplace.permission.admin");
}

/** The properties of a catalog listing, as the desktop page lists them beside its content. */
function useCatalogFacts(listing: MarketplaceListing, version: number, updatedAt: string, installs: number) {
  const { t, format } = useText();
  return [
    { label: t("mobile.marketplace.facts.installs"), value: format.compact(installs) },
    ...(listing.category
      ? [{ label: t("mobile.marketplace.facts.category"), value: t(CATEGORY_LABELS[listing.category]) }]
      : []),
    { label: t("mobile.marketplace.facts.version"), value: format.number(version) },
    { label: t("mobile.marketplace.facts.updated"), value: format.date(new Date(updatedAt), { dateStyle: "medium" }) },
    { label: t("mobile.marketplace.facts.creator"), value: listing.creatorName },
  ];
}

function AgentPage({
  serverId,
  listing,
  detail,
  onBusy,
}: {
  serverId: string;
  listing: MarketplaceListing;
  detail: MarketplaceAgentDetail;
  onBusy: (busy: boolean) => void;
}) {
  const { t, errorMessage } = useText();
  const { installMarketplaceAgent, refreshServer } = useMobileWorkspaceActions();
  const canAdd = useMobileWorkspaceSelector((workspace) => workspace.canAddMarketplaceAgents(serverId));
  const installed = useMarketplaceInstalled(serverId);
  const canUpdate = useMobileWorkspaceSelector((workspace) => workspace.canUpdateMarketplaceAgents(serverId));
  const added = installed.agentFor(detail.id);
  // The agent that this page added or updated, before the refreshed agent list shows it. Without it,
  // the `+` comes back in that time, and a second tap adds a second agent.
  const [finished, setFinished] = useState<string | null>(null);
  const addedId = added?.id ?? finished;
  const updatable =
    finished === null &&
    canUpdate &&
    added?.marketplaceSource !== undefined &&
    added.marketplaceSource.version < detail.version;
  const block = useInstallBlock(serverId, canAdd);
  const facts = useCatalogFacts(listing, detail.version, detail.updatedAt, detail.installs);
  const [muted] = useThemeColor(["muted"]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  async function install() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    onBusy(true);
    setError(null);
    try {
      const result = await mobileAnalytics.operation(
        "marketplace_action",
        { entity: "agent", action: added ? "update" : "install" },
        () =>
          installMarketplaceAgent(
            {
              listingId: detail.id,
              ...(added ? { agentId: added.id } : {}),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              // Counts one install, however often a retry sends it.
              receiptId: Crypto.randomUUID(),
            },
            serverId,
          ),
      );
      setFinished(result.id);
      void haptics.notification("success");
      // The chat list shows the new agent; a failed refresh does not make the install fail.
      void refreshServer(serverId).catch(() => undefined);
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.marketplace.installFailed")));
    } finally {
      lock.current = false;
      setPending(false);
      onBusy(false);
    }
  }

  return (
    <>
      <ListingHeaderAction
        kind={updatable ? "update" : "add"}
        hidden={(addedId !== null && !updatable) || block !== null}
        pending={pending}
        label={
          pending
            ? t(updatable ? "mobile.marketplace.agent.updating" : "mobile.marketplace.agent.adding")
            : t(updatable ? "mobile.marketplace.agent.update" : "mobile.marketplace.agent.add")
        }
        onPress={() => void install()}
      />
      <ListingHeader listing={listing}>
        {detail.skills.length > 0 ? <HeroChips items={detail.skills.slice(0, 4).map((item) => item.name)} /> : null}
      </ListingHeader>
      <ListingFacts facts={facts} />
      {detail.description ? <Typography.Paragraph>{detail.description}</Typography.Paragraph> : null}
      {pending ? (
        <SettingsNote>
          {t(updatable ? "mobile.marketplace.agent.updating" : "mobile.marketplace.agent.adding")}
        </SettingsNote>
      ) : null}
      {addedId ? (
        // The app's own black or white action, not the accent; the scale feedback has no tinted flash.
        <Button
          className="bg-action"
          feedbackVariant="scale"
          onPress={() => router.replace({ pathname: "/chat/[agentId]", params: { agentId: addedId } })}
        >
          <Button.Label className="text-action-foreground">{t("mobile.marketplace.agent.openChat")}</Button.Label>
        </Button>
      ) : null}
      {updatable ? <SettingsNote>{t("mobile.marketplace.agent.updateAvailable")}</SettingsNote> : null}
      {block && !addedId ? <SettingsNote>{block}</SettingsNote> : null}
      <ErrorText error={error} />
      {detail.skills.length > 0 ? (
        <ListingBlock title={t("mobile.marketplace.agent.skills")}>
          <SettingsSection>
            {detail.skills.map((item) => (
              <SettingsRow
                key={item.skillId}
                supportingText={t("mobile.marketplace.agent.skillVersion", { version: item.version })}
              >
                <Typography.Paragraph numberOfLines={1}>{item.name}</Typography.Paragraph>
              </SettingsRow>
            ))}
          </SettingsSection>
        </ListingBlock>
      ) : null}
      {detail.routines.length > 0 ? (
        <ListingBlock title={t("mobile.marketplace.agent.routines")}>
          <SettingsSection>
            {detail.routines.map((routine) => (
              <SettingsRow
                key={routine.name}
                leading={<CalendarClock color={String(muted)} size={20} strokeWidth={1.8} />}
                supportingText={routine.instruction}
                trailing={
                  <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
                    {t(
                      routine.active
                        ? "mobile.marketplace.agent.routineActive"
                        : "mobile.marketplace.agent.routinePaused",
                    )}
                  </Typography.Paragraph>
                }
              >
                <Typography.Paragraph numberOfLines={1}>{routine.name}</Typography.Paragraph>
              </SettingsRow>
            ))}
          </SettingsSection>
        </ListingBlock>
      ) : null}
    </>
  );
}

/** The SKILL.md body without its first heading, when that heading only repeats the name, as on the desktop. */
function skillInstructions(skill: Pick<MarketplaceSkillDetail, "name" | "description" | "instructions">): string {
  const instructions = skill.instructions || skill.description;
  const [first, ...rest] = instructions.split(/\r?\n/u);
  return first?.replace(/^#\s+/u, "").trim() === skill.name ? rest.join("\n").trim() : instructions;
}

function SkillPage({
  serverId,
  listing,
  detail,
}: {
  serverId: string;
  listing: MarketplaceListing;
  detail: MarketplaceSkillDetail;
}) {
  const { t } = useText();
  const [foreground] = useThemeColor(["foreground"]);
  const canManage = useMobileWorkspaceSelector((workspace) => workspace.canManageAgentSkills(serverId));
  const block = useInstallBlock(serverId, canManage);
  const installed = useMarketplaceInstalled(serverId);
  const holders = installed.skillAgentIds(detail.id);
  const holderNames = installed.agents.filter((agent) => holders.includes(agent.id)).map((agent) => agent.name);
  const everyAgentHasIt = installed.agents.length > 0 && holders.length === installed.agents.length;
  const facts = useCatalogFacts(listing, detail.version, detail.updatedAt, detail.installs);
  const chooseAgents = () =>
    router.push({ pathname: "/marketplace-listing/agents", params: { serverId, skillId: detail.id } });
  const tryInChat = useTryInChat(serverId);
  const usable = installed.usableSkillAgentIds(detail.id, detail.version);
  const example = detail.examplePrompt?.trim() || t("mobile.marketplace.skill.examplePrompt");
  // As on the desktop: the skill's marker, then the example, so the agent knows which skill to use.
  const request = `${serializeChatTagReference("skill", detail.name, detail.id)} ${example}`;
  const targets = {
    agents: installed.agents.filter((agent) => usable.includes(agent.id)),
    onTry: (agentId: string) => tryInChat(agentId, request),
  };
  const tryCaption =
    targets.agents.length > 0
      ? null
      : holders.length > 0
        ? t("mobile.marketplace.try.skillNotReady")
        : t("mobile.marketplace.try.skillNotAdded");

  return (
    <>
      <ListingHeaderAction
        kind="add"
        hidden={block !== null || everyAgentHasIt}
        pending={false}
        label={t("mobile.marketplace.skill.add")}
        onPress={chooseAgents}
      />
      <ListingHeader listing={listing}>
        <HeroRequest listing={listing} text={example} targets={targets} caption={tryCaption} />
      </ListingHeader>
      <ListingFacts facts={facts} />
      <Typography.Paragraph>{detail.description}</Typography.Paragraph>
      {block ? (
        <SettingsNote>{block}</SettingsNote>
      ) : (
        <SettingsSection>
          <SettingsRow
            supportingText={holderNames.length > 0 ? holderNames.join(", ") : t("mobile.marketplace.skill.noAgents")}
            disabled={everyAgentHasIt}
            onPress={everyAgentHasIt ? undefined : chooseAgents}
          >
            <Typography.Paragraph>{t("mobile.marketplace.skill.installedOn")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      )}
      <ListingBlock title={t("mobile.marketplace.skill.doc")}>
        <View className="rounded-grouped bg-grouped px-4 py-3" style={{ borderCurve: "continuous" }}>
          <ChatMarkdown
            body={skillInstructions(detail)}
            color={String(foreground)}
            finished
            animationEnabled={false}
            linkFavicons={false}
          />
        </View>
      </ListingBlock>
    </>
  );
}

function AppPage({
  serverId,
  listing,
  plugin,
  onBusy,
}: {
  serverId: string;
  listing: MarketplaceListing;
  plugin: MobilePlugin;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useText();
  const canManage = useMobileWorkspaceSelector((workspace) => workspace.canManageMcpServers(serverId));
  const canRelay = useMobileWorkspaceSelector((workspace) => workspace.canRelayMcpSignIn(serverId));
  const block = useInstallBlock(serverId, canManage);
  const installed = useMarketplaceInstalled(serverId);
  const app = plugin.apps[0] ?? null;
  const method = app ? pluginConnectMethod(app, canRelay) : null;
  const connect = usePluginConnect(serverId, app, method);
  const connected = connect.state.phase === "done" || installed.installed(listing);
  const working = connect.state.phase === "working";
  useEffect(() => onBusy(working), [onBusy, working]);
  const installable =
    !connected && block === null && (method?.kind === "none" || method?.kind === "key" || method?.kind === "link");
  const [first, ...more] = plugin.prompts;
  const [muted] = useThemeColor(["muted"]);
  const tryInChat = useTryInChat(serverId);
  // An app's tools reach every agent of the server, so any agent can try it once it is connected.
  // The request is the question alone, as on the desktop: there is no marker to point at.
  const targetsFor = (text: string) => ({
    agents: connected ? installed.agents : [],
    onTry: (agentId: string) => tryInChat(agentId, text),
  });
  const openLink = (url: string) => void Linking.openURL(url).catch(() => undefined);
  const links = [
    plugin.websiteUrl ? { label: t("mobile.marketplace.app.website"), url: plugin.websiteUrl } : null,
    plugin.privacyPolicyUrl ? { label: t("mobile.marketplace.app.privacy"), url: plugin.privacyPolicyUrl } : null,
    plugin.termsUrl ? { label: t("mobile.marketplace.app.terms"), url: plugin.termsUrl } : null,
  ].filter((link) => link !== null);
  const access =
    method?.kind === "key"
      ? t("mobile.marketplace.facts.accessKey")
      : method?.kind === "link" || method?.kind === "relayUnsupported"
        ? t("mobile.marketplace.facts.accessSignIn")
        : method?.kind === "local"
          ? t("mobile.marketplace.facts.accessLocal")
          : t("mobile.marketplace.facts.accessNone");
  const facts = [
    { label: t("mobile.marketplace.facts.access"), value: access },
    ...(listing.category
      ? [{ label: t("mobile.marketplace.facts.category"), value: t(CATEGORY_LABELS[listing.category]) }]
      : []),
    { label: t("mobile.marketplace.facts.version"), value: plugin.version },
    { label: t("mobile.marketplace.facts.creator"), value: plugin.creatorName },
  ];

  function add() {
    // An app that asks for nothing connects from here; a key or a sign-in has its own page.
    if (method?.kind === "none") void connect.connect();
    else router.push({ pathname: "/marketplace-listing/connect", params: { serverId, slug: plugin.slug } });
  }

  return (
    <>
      <ListingHeaderAction
        kind="add"
        hidden={!installable}
        pending={working}
        label={working ? t("mobile.marketplace.app.connecting") : t("mobile.marketplace.app.add")}
        onPress={add}
      />
      <ListingHeader listing={listing}>
        {first ? (
          <HeroRequest
            listing={listing}
            text={first.text}
            targets={targetsFor(first.text)}
            caption={connected ? null : t("mobile.marketplace.try.appNotConnected")}
          />
        ) : (
          <HeroChips items={[plugin.tagline]} />
        )}
      </ListingHeader>
      <ListingFacts facts={facts} />
      <Typography.Paragraph>{plugin.description}</Typography.Paragraph>
      {working ? <SettingsNote>{t("mobile.marketplace.app.connecting")}</SettingsNote> : null}
      {connected ? (
        <SettingsSection footer={t("mobile.marketplace.app.connectedHint")}>
          <SettingsRow
            onPress={() => {
              // The app's own MCP page; the list when the row is not known yet, such as right after a connect.
              const mcpServerId = pluginServerId(plugin, installed.mcpServers ?? []);
              if (mcpServerId)
                router.push({ pathname: "/server-settings/mcp-server", params: { serverId, mcpServerId } });
              else router.push({ pathname: "/server-settings/mcp", params: { serverId } });
            }}
          >
            <Typography.Paragraph>{t("mobile.marketplace.app.connected")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : block ? (
        <SettingsNote>{block}</SettingsNote>
      ) : method?.kind === "local" ? (
        <SettingsNote>{t("mobile.marketplace.app.local")}</SettingsNote>
      ) : method?.kind === "relayUnsupported" ? (
        <SettingsNote>{t("mobile.marketplace.app.relayUnsupported")}</SettingsNote>
      ) : null}
      <ErrorText error={connect.error} />
      {more.length > 0 ? (
        <ListingBlock title={t("mobile.marketplace.app.prompts")}>
          <View className="gap-2">
            {more.map((prompt) => (
              <TryPressable key={prompt.id} targets={targetsFor(prompt.text)} label={prompt.text}>
                <View
                  className="flex-row items-center gap-3 rounded-grouped bg-grouped px-4 py-3"
                  style={{ borderCurve: "continuous" }}
                >
                  <Typography.Paragraph className="min-w-0 flex-1">{prompt.text}</Typography.Paragraph>
                  {connected ? <ArrowRight color={String(muted)} size={18} strokeWidth={2} /> : null}
                </View>
              </TryPressable>
            ))}
          </View>
        </ListingBlock>
      ) : null}
      {links.length > 0 ? (
        <SettingsSection>
          {links.map((link) => (
            <SettingsRow key={link.url} onPress={() => openLink(link.url)}>
              <Typography.Paragraph>{link.label}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
    </>
  );
}
