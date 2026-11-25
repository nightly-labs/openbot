import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { Button, Plus, Workflow } from "@openbot/ui";
import { useText } from "../../text";
import { TabShape } from "../conversation/TabShape";
import { ThreadTabs } from "../conversation/threads/ThreadTabs";
import type { ThreadItem } from "../conversation/threads/thread-types";

export interface WorkflowCanvasTabs {
  ids: readonly string[];
  onClose: (workflowId: string) => void;
  onCloseOthers: (workflowId: string) => void;
  onCloseRight: (workflowId: string) => void;
  onMove: (workflowId: string, index: number) => void;
}

export interface WorkflowTab {
  id: string;
  title: string;
  updatedAt: string;
  running: boolean;
}

const asThread = (tab: WorkflowTab): ThreadItem => ({
  id: tab.id,
  kind: "side",
  title: tab.title,
  updatedAt: tab.updatedAt,
  status: tab.running ? { kind: "working" } : { kind: "idle" },
});

export function WorkflowTabs(props: {
  tabs: readonly WorkflowTab[];
  current: string;
  readOnly: boolean;
  control: WorkflowCanvasTabs | undefined;
  onOpen: (workflowId: string) => void;
  onNew: () => void;
  onRename: (workflowId: string, title: string) => void;
}) {
  const { t } = useText();
  const threads = () => props.tabs.map(asThread);
  const single = () => (props.tabs.length < 2 ? "" : undefined);
  return (
    <div class="wfn-hud wfn-hud-title wfn-tab-row" data-single={single()}>
      <ThreadTabs
        threads={threads()}
        tabs={threads()}
        archived={[]}
        activeId={props.current}
        canStartNew={!props.readOnly}
        onOpen={props.onOpen}
        onNew={props.onNew}
        onClose={(id) => props.control?.onClose(id)}
        onCloseOthers={(id) => props.control?.onCloseOthers(id)}
        onCloseToTheRight={(id) => props.control?.onCloseRight(id)}
        onMove={(id, index) => props.control?.onMove(id, index)}
        onRestore={props.onOpen}
        onRename={props.readOnly ? undefined : props.onRename}
        tabText={{
          list: t("workflow.canvas.tabs.list"),
          actions: t("workflow.canvas.tabs.actions"),
          name: t("workflow.canvas.switcher.name"),
          limit: INPUT_LIMITS.workflowTitle,
        }}
        tabIcon={() => <Workflow aria-hidden="true" />}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        class="agent-threads-icon-button wfn-tab-new no-drag"
        aria-label={t("workflow.canvas.switcher.new")}
        title={t("workflow.canvas.switcher.new")}
        disabled={props.readOnly}
        onClick={() => props.onNew()}
      >
        <Plus aria-hidden="true" />
      </Button>
      <TabShape
        selected='.agent-threads-tab[aria-selected="true"]'
        sized=".agent-threads-tabs, .agent-threads-tab"
        scroller=".agent-threads-tabs"
      />
    </div>
  );
}
