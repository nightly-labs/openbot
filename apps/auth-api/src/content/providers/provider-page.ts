import type { LandingIconName } from "../../components/landing/LandingIcon";
import type { ComparisonQuestion, ComparisonSource, OpenBotPlan } from "../compare/comparison";

export interface ProviderAdd {
  icon: LandingIconName;
  title: string;
  text: string;
}

interface ProviderOfficialApp {
  name: string;
  platforms: string;
  note: string;
}

export interface ProviderPage {
  provider: OpenBotPlan["provider"];
  name: string;
  answer: string;
  connect: string;
  adds: readonly ProviderAdd[];
  vendor: string;
  officialApps: readonly ProviderOfficialApp[];
  comparisons: readonly string[];
  faq: readonly ComparisonQuestion[];
  sources: readonly ComparisonSource[];
  checkedAt: string;
}

const OPENBOT_PHONE_ADD: ProviderAdd = {
  icon: "phone",
  title: "Your agents on your phone",
  text: "The OpenBot apps for iPhone and Android connect to the computer that runs your agents, over an encrypted connection, with no VPN. Remote access needs an OpenBot account.",
};

export const OPENBOT_ADDS: readonly ProviderAdd[] = [
  {
    icon: "users",
    title: "A team, not one chat",
    text: "Each agent has its own job and workspace. A lead agent gives parts of a task to other agents in a shared channel, and you step in when a decision needs you.",
  },
  OPENBOT_PHONE_ADD,
  {
    icon: "blocks",
    title: "Change the provider, keep the work",
    text: "Move an agent to a different provider and it keeps its role, workspace and conversation. Agents on different providers work in the same channel. When a plan reaches its limit, an agent can move to a backup model.",
  },
  {
    icon: "lock",
    title: "Your data on your computer",
    text: "Workspaces, chats and files stay on the computer that runs OpenBot. The provider you choose gets the requests you send.",
  },
  {
    icon: "tag",
    title: "Use your AI plans",
    text: "OpenBot is free for noncommercial use. Your agents use the plans you already pay for.",
  },
];
