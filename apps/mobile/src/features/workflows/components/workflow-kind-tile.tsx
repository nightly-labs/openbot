import type { WorkflowNodeKind, WorkflowTriggerType } from "@openbot/contracts/ipc";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import type { LucideIcon } from "@/shared/icons";
import {
  AtSign,
  Bot,
  Clock,
  FileIcon as File,
  GitBranch,
  GitPullRequest,
  ImageIcon as Image,
  MessageSquare,
  MessageSquareText,
  Send,
  Sparkles,
  StickyNote,
  UserRoundCheck,
  Webhook,
  Zap,
} from "@/shared/icons";

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
  discord: AtSign,
  telegram: Send,
  slack: AtSign,
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
