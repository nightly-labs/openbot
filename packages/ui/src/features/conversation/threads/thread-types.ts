import type { SidebarWaitReason } from "@openbot/ui/features/sidebar/sidebar-types";

export type ThreadStatus =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "queued" }
  | { kind: "waiting"; reason: SidebarWaitReason }
  | { kind: "awaiting" }
  | { kind: "failed" };

export interface ThreadItem {
  id: string;
  kind: "side" | "draft";
  title: string;
  updatedAt: string;
  status: ThreadStatus;
  unread?: number | undefined;
  stem?: ThreadStem | undefined;
}

export interface ThreadStem {
  through: readonly boolean[];
  last: boolean;
}

export type ThreadRowMode = "tabs" | "compact" | "minimal";

export function threadBusy(status: ThreadStatus): boolean {
  return status.kind === "working" || status.kind === "waiting";
}

export interface ThreadHeaderProps {
  threads: readonly ThreadItem[];
  tabs: readonly ThreadItem[];
  archived: readonly ThreadItem[];
  activeId: string;
  canStartNew: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseToTheRight: (id: string) => void;
  onMove: (id: string, index: number) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onRename?: ((id: string, title: string) => void) | undefined;
  onDelete?: ((id: string) => void) | undefined;
  onMoveToSide?: ((id: string) => void) | undefined;
}

export const MAIN_THREAD_ID = "main";
export const DRAFT_THREAD_ID = "draft";
