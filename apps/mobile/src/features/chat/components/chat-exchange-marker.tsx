import type { AgentExchangeSummary } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { Link } from "expo-router";
import { Typography } from "heroui-native";
import { ChevronDown } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import type { ChatMessage, ExchangeGroup, ExchangeMarker } from "@/features/chat/model/chat-messages";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

type RoutingMarker = Extract<ChatMessage, { kind: "channel-routing" }>;

interface MarkerContext {
  agents: MobileAgent[];
  agentsById: ReadonlyMap<string, MobileAgent>;
  muted: ViewStyle["backgroundColor"];
}

/**
 * Matches the desktop marker. An absent mark means a request: that is what a host older than the
 * mark reports, and what every message stored before it meant.
 */
function exchangeLabel(exchange: AgentExchangeSummary, t: MobileTranslate) {
  if (exchange.expectsReply === false)
    return exchange.direction === "outgoing"
      ? t("mobile.chat.exchange.informed")
      : t("mobile.chat.exchange.updateFrom");
  return exchange.direction === "outgoing" ? t("mobile.chat.exchange.messaged") : t("mobile.chat.exchange.messageFrom");
}

function exchangeAgentIds(exchange: AgentExchangeSummary) {
  return exchange.direction === "incoming" ? [exchange.senderAgentId] : exchange.recipientAgentIds;
}

/** One message to or from other agents, or a channel routing. */
export function ChatExchangeMarker({
  message,
  agents,
  agentsById,
  muted,
}: MarkerContext & { message: ExchangeMarker | RoutingMarker }) {
  const { t } = useText();
  const [open, setOpen] = useState(false);
  const label =
    message.kind === "channel-routing"
      ? message.event.action === "assigned"
        ? t("mobile.chat.exchange.assignedTo")
        : t("mobile.chat.exchange.continuingWith")
      : exchangeLabel(message.exchange, t);
  const ids = message.kind === "channel-routing" ? [message.event.agentId] : exchangeAgentIds(message.exchange);
  const badges = ids.map((id) => {
    const legacyName =
      message.kind === "channel-routing" && message.event.agentId === null ? message.event.agentName : null;
    const legacyMatches = legacyName ? agents.filter((agent) => agent.name === legacyName) : [];
    const participant = id ? agentsById.get(id) : legacyMatches.length === 1 ? legacyMatches[0] : undefined;
    const badge = (
      <AgentBadge
        key={id ?? legacyName}
        agent={participant}
        name={
          participant?.name ??
          (message.kind === "channel-routing"
            ? (legacyName ?? t("mobile.chat.exchange.unavailableAgent"))
            : t("mobile.chat.exchange.unknownAgent"))
        }
        muted={muted}
      />
    );
    return message.kind === "channel-routing" && participant ? (
      <Link key={participant.id} href={{ pathname: "/chat/[agentId]", params: { agentId: participant.id } }} asChild>
        <ChatLinkPressable
          accessibilityRole="link"
          accessibilityLabel={t("mobile.chat.exchange.openChat", { name: participant.name })}
        >
          {badge}
        </ChatLinkPressable>
      </Link>
    ) : (
      <View key={id ?? legacyName}>{badge}</View>
    );
  });
  // Like desktop, a message to several agents names how many, and opens to list them.
  if (badges.length > 1) {
    const agentCount = t("mobile.chat.exchange.agentCount", { count: badges.length });
    return (
      <View className="items-center gap-2 py-2">
        <View className="flex-row flex-wrap items-center justify-center gap-2">
          <Typography.Paragraph type="body-sm" style={{ color: muted }}>
            {label}
          </Typography.Paragraph>
          <AgentsToggle
            agents={ids.map((id) => (id ? agentsById.get(id) : undefined))}
            label={agentCount}
            accessibilityLabel={agentCount}
            open={open}
            onToggle={() => setOpen((value) => !value)}
            muted={muted}
          />
        </View>
        {open ? <View className="flex-row flex-wrap items-center justify-center gap-2">{badges}</View> : null}
      </View>
    );
  }
  return (
    <View className="flex-row flex-wrap items-center justify-center gap-2 py-2">
      <Typography.Paragraph type="body-sm" style={{ color: muted }}>
        {label}
      </Typography.Paragraph>
      {badges}
    </View>
  );
}

/**
 * Consecutive messages to and from other agents, drawn as one row as on desktop. The row names how
 * many messages and agents there are, and opens to show each message's own marker.
 */
export function ChatExchangeGroup({ group, agents, agentsById, muted }: MarkerContext & { group: ExchangeGroup }) {
  const { t } = useText();
  const [open, setOpen] = useState(false);
  const ids = [...new Set(group.exchanges.flatMap(({ exchange }) => exchangeAgentIds(exchange)))];
  const participants = ids.map((id) => agentsById.get(id));
  const count = group.exchanges.length;
  const agentsLabel =
    ids.length === 1
      ? (participants[0]?.name ?? t("mobile.chat.exchange.unknownAgent"))
      : t("mobile.chat.exchange.agentCount", { count: ids.length });
  return (
    <View className="items-center py-2">
      <View className="flex-row flex-wrap items-center justify-center gap-2">
        <Typography.Paragraph type="body-sm" style={{ color: muted }}>
          {t("mobile.chat.exchange.group", { count })}
        </Typography.Paragraph>
        <AgentsToggle
          agents={participants}
          label={agentsLabel}
          accessibilityLabel={t(open ? "mobile.chat.exchange.hideMessages" : "mobile.chat.exchange.showMessages", {
            count,
            agents: agentsLabel,
          })}
          open={open}
          onToggle={() => setOpen((value) => !value)}
          muted={muted}
        />
      </View>
      {open
        ? group.exchanges.map((item) => (
            <ChatExchangeMarker key={item.id} message={item} agents={agents} agentsById={agentsById} muted={muted} />
          ))
        : null}
    </View>
  );
}

function AgentBadge({
  agent,
  name,
  muted,
}: {
  agent: MobileAgent | undefined;
  name: string;
  muted: ViewStyle["backgroundColor"];
}) {
  return (
    <View className="flex-row items-center gap-1">
      {agent ? <AgentThumbnail agent={agent} /> : null}
      <Typography.Paragraph type="body-sm" style={{ color: muted }}>
        {name}
      </Typography.Paragraph>
    </View>
  );
}

function AgentThumbnail({ agent }: { agent: MobileAgent }) {
  return (
    <BloubAvatarThumbnail
      agentId={agent.id}
      serverId={agent.serverId}
      hue={agent.avatarHue}
      seed={agent.avatarSeed}
      size={22}
    />
  );
}

/** The avatars of up to three agents, as on desktop, and a label that opens the list under the row. */
function AgentsToggle({
  agents,
  label,
  accessibilityLabel,
  open,
  onToggle,
  muted,
}: {
  agents: (MobileAgent | undefined)[];
  label: string;
  accessibilityLabel: string;
  open: boolean;
  onToggle: () => void;
  muted: ViewStyle["backgroundColor"];
}) {
  const shown = agents.filter((agent) => agent !== undefined).slice(0, 3);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={() => {
        void haptics.selection();
        onToggle();
      }}
      className="flex-row items-center gap-1"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {shown.length ? (
        <View className="flex-row">
          {shown.map((agent, index) => (
            <View key={agent.id} style={index ? { marginLeft: -8 } : undefined}>
              <AgentThumbnail agent={agent} />
            </View>
          ))}
        </View>
      ) : null}
      <Typography.Paragraph type="body-sm" style={{ color: muted }}>
        {label}
      </Typography.Paragraph>
      <ChevronDown
        size={14}
        color={String(muted)}
        strokeWidth={2}
        style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
      />
    </Pressable>
  );
}
