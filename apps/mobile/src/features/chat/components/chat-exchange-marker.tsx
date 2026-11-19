import type { AgentExchangeSummary } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { Link } from "expo-router";
import type { LucideIcon } from "lucide-react-native";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Forward from "lucide-react-native/icons/forward";
import Inbox from "lucide-react-native/icons/inbox";
import Megaphone from "lucide-react-native/icons/megaphone";
import MessagesSquare from "lucide-react-native/icons/messages-square";
import Send from "lucide-react-native/icons/send";
import UserCheck from "lucide-react-native/icons/user-check";
import type { ReactNode } from "react";
import { View } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import type { ChatMessage, ExchangeGroup, ExchangeMarker } from "@/features/chat/model/chat-messages";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { ACTIVITY_ICON_SIZE, ChatActivityLine, useActivityColors } from "./chat-activity-line";
import { useKeptOpen } from "./use-kept-open";

type RoutingMarker = Extract<ChatMessage, { kind: "channel-routing" }>;

const AVATAR_SIZE = 16;
const CHEVRON_SIZE = 12;

interface MarkerContext {
  agents: MobileAgent[];
  agentsById: ReadonlyMap<string, MobileAgent>;
}

function exchangeLabel(exchange: AgentExchangeSummary, t: MobileTranslate) {
  if (exchange.expectsReply === false)
    return exchange.direction === "outgoing"
      ? t("mobile.chat.exchange.informed")
      : t("mobile.chat.exchange.updateFrom");
  return exchange.direction === "outgoing" ? t("mobile.chat.exchange.messaged") : t("mobile.chat.exchange.messageFrom");
}

function exchangeIcon(exchange: AgentExchangeSummary): LucideIcon {
  if (exchange.direction === "incoming") return Inbox;
  return exchange.expectsReply === false ? Megaphone : Send;
}

function exchangeAgentIds(exchange: AgentExchangeSummary) {
  return exchange.direction === "incoming" ? [exchange.senderAgentId] : exchange.recipientAgentIds;
}

export function ChatExchangeMarker({
  message,
  agents,
  agentsById,
}: MarkerContext & { message: ExchangeMarker | RoutingMarker }) {
  const { t } = useText();
  const colors = useActivityColors();
  const [open, setOpen] = useKeptOpen(`marker:${message.id}`, false);
  const routing = message.kind === "channel-routing";
  const label = routing
    ? message.event.action === "assigned"
      ? t("mobile.chat.exchange.assignedTo")
      : t("mobile.chat.exchange.continuingWith")
    : exchangeLabel(message.exchange, t);
  const Icon = routing ? (message.event.action === "assigned" ? UserCheck : Forward) : exchangeIcon(message.exchange);
  const icon = <Icon size={ACTIVITY_ICON_SIZE} color={colors.muted} />;
  const ids = routing ? [message.event.agentId] : exchangeAgentIds(message.exchange);
  const participants = ids.map((id) => {
    const legacyName = routing && message.event.agentId === null ? message.event.agentName : null;
    const legacyMatches = legacyName ? agents.filter((agent) => agent.name === legacyName) : [];
    const agent = id ? agentsById.get(id) : legacyMatches.length === 1 ? legacyMatches[0] : undefined;
    const name =
      agent?.name ??
      (routing ? (legacyName ?? t("mobile.chat.exchange.unavailableAgent")) : t("mobile.chat.exchange.unknownAgent"));
    return { key: id ?? legacyName ?? name, agent, name };
  });
  const [only] = participants;
  if (participants.length <= 1) {
    return (
      <AgentLine
        agent={only?.agent}
        linked={routing}
        icon={icon}
        label={label}
        name={only?.name}
        nameIcon={only?.agent ? <AgentThumbnail agent={only.agent} /> : null}
      />
    );
  }
  const agentCount = t("mobile.chat.exchange.agentCount", { count: participants.length });
  return (
    <View>
      <ChatActivityLine
        icon={icon}
        label={label}
        name={agentCount}
        nameIcon={<AgentStack agents={participants.map(({ agent }) => agent)} />}
        accessibilityLabel={`${label}, ${agentCount}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        trailing={<ExpandChevron open={open} />}
      />
      {open ? (
        <View className="ps-5">
          {participants.map(({ key, agent, name }) => (
            <AgentLine
              key={key}
              agent={agent}
              linked={routing}
              icon={agent ? <AgentThumbnail agent={agent} /> : icon}
              name={name}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function ChatExchangeGroup({ group, agents, agentsById }: MarkerContext & { group: ExchangeGroup }) {
  const { t } = useText();
  const colors = useActivityColors();
  const [open, setOpen] = useKeptOpen(`group:${group.id}`, false);
  const ids = [...new Set(group.exchanges.flatMap(({ exchange }) => exchangeAgentIds(exchange)))];
  const participants = ids.map((id) => agentsById.get(id));
  const count = group.exchanges.length;
  const label = t("mobile.chat.exchange.group", { count });
  const agentsLabel =
    ids.length === 1
      ? (participants[0]?.name ?? t("mobile.chat.exchange.unknownAgent"))
      : t("mobile.chat.exchange.agentCount", { count: ids.length });
  return (
    <View>
      <ChatActivityLine
        icon={<MessagesSquare size={ACTIVITY_ICON_SIZE} color={colors.muted} />}
        label={label}
        name={agentsLabel}
        nameIcon={<AgentStack agents={participants} />}
        accessibilityLabel={t(open ? "mobile.chat.exchange.hideMessages" : "mobile.chat.exchange.showMessages", {
          count,
          agents: agentsLabel,
        })}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        trailing={<ExpandChevron open={open} />}
      />
      {open ? (
        <View className="ps-5">
          {group.exchanges.map((item) => (
            <ChatExchangeMarker key={item.id} message={item} agents={agents} agentsById={agentsById} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function AgentLine({
  agent,
  linked,
  icon,
  label,
  name,
  nameIcon,
}: {
  agent: MobileAgent | undefined;
  linked: boolean;
  icon: ReactNode;
  label?: string;
  name?: string;
  nameIcon?: ReactNode;
}) {
  const { t } = useText();
  const colors = useActivityColors();
  const accessibilityLabel = [label, name].filter(Boolean).join(", ");
  if (!linked || !agent)
    return (
      <ChatActivityLine
        icon={icon}
        label={label}
        name={name}
        nameIcon={nameIcon}
        accessibilityLabel={accessibilityLabel}
      />
    );
  return (
    <Link href={{ pathname: "/chat/[agentId]", params: { agentId: agent.id } }} asChild>
      <ChatLinkPressable
        accessibilityRole="link"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={t("mobile.chat.exchange.openChat", { name: agent.name })}
        hitSlop={8}
        className="max-w-full self-start"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <ChatActivityLine
          icon={icon}
          label={label}
          name={name}
          nameIcon={nameIcon}
          accessibilityLabel={accessibilityLabel}
          trailing={<ChevronRight size={CHEVRON_SIZE} color={colors.dim} style={MIRROR_IN_RTL} />}
        />
      </ChatLinkPressable>
    </Link>
  );
}

function AgentThumbnail({ agent }: { agent: MobileAgent }) {
  return (
    <BloubAvatarThumbnail
      agentId={agent.id}
      serverId={agent.serverId}
      hue={agent.avatarHue}
      color={agent.avatarColor}
      seed={agent.avatarSeed}
      size={AVATAR_SIZE}
    />
  );
}

function AgentStack({ agents }: { agents: (MobileAgent | undefined)[] }) {
  const shown = agents.filter((agent) => agent !== undefined).slice(0, 3);
  if (!shown.length) return null;
  return (
    <View className="flex-row">
      {shown.map((agent, index) => (
        <View key={agent.id} style={index ? { marginLeft: -6 } : undefined}>
          <AgentThumbnail agent={agent} />
        </View>
      ))}
    </View>
  );
}

function ExpandChevron({ open }: { open: boolean }) {
  const colors = useActivityColors();
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View
      style={{
        transform: [{ rotate: open ? "180deg" : "0deg" }],
        transitionProperty: "transform",
        transitionDuration: reducedMotion ? 0 : 160,
        transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
      }}
    >
      <ChevronDown size={CHEVRON_SIZE} color={colors.dim} strokeWidth={2} />
    </Animated.View>
  );
}
