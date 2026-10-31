import type { WorkflowNodeKind, WorkflowTriggerType } from "@openbot/contracts/ipc";
import type { LucideIcon } from "lucide-react-native";
import Bot from "lucide-react-native/icons/bot";
import Clock from "lucide-react-native/icons/clock";
import File from "lucide-react-native/icons/file";
import GitBranch from "lucide-react-native/icons/git-branch";
import GitPullRequest from "lucide-react-native/icons/git-pull-request";
import Image from "lucide-react-native/icons/image";
import MessageSquare from "lucide-react-native/icons/message-square";
import MessageSquareText from "lucide-react-native/icons/message-square-text";
import Send from "lucide-react-native/icons/send";
import Sparkles from "lucide-react-native/icons/sparkles";
import StickyNote from "lucide-react-native/icons/sticky-note";
import UserRoundCheck from "lucide-react-native/icons/user-round-check";
import Webhook from "lucide-react-native/icons/webhook";
import Zap from "lucide-react-native/icons/zap";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";

/** The colour family of each kind, from the file reference tokens: the same hues in both themes. */
const KIND_TINT: Record<WorkflowNodeKind, string> = {
  trigger: "default",
  agent: "blue",
  llm: "pink",
  condition: "yellow",
  approval: "orange",
  output: "green",
  prompt: "teal",
  image: "teal",
  asset: "teal",
  text: "default",
  note: "default",
  shape: "default",
};

const KIND_ICON: Record<WorkflowNodeKind, LucideIcon> = {
  trigger: Zap,
  agent: Bot,
  llm: Sparkles,
  condition: GitBranch,
  approval: UserRoundCheck,
  output: Send,
  prompt: MessageSquareText,
  image: Image,
  asset: File,
  text: StickyNote,
  note: StickyNote,
  shape: StickyNote,
};

const TRIGGER_ICON: Record<WorkflowTriggerType, LucideIcon> = {
  manual: Zap,
  schedule: Clock,
  webhook: Webhook,
  message: MessageSquare,
  github: GitPullRequest,
};

/** The icon of a step on its colour, as the desktop canvas marks each kind. */
export function WorkflowKindTile({
  kind,
  trigger,
  size = 32,
}: {
  kind: WorkflowNodeKind;
  /** The type of a trigger, which picks its icon. */
  trigger?: WorkflowTriggerType;
  size?: number;
}) {
  const tint = KIND_TINT[kind];
  const [color, background] = useCSSVariable([`--openbot-file-${tint}`, `--openbot-file-${tint}-soft`]);
  const Icon = kind === "trigger" && trigger ? TRIGGER_ICON[trigger] : KIND_ICON[kind];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: String(background) }}
    >
      <Icon color={String(color)} size={Math.round(size * 0.56)} strokeWidth={1.9} />
    </View>
  );
}
