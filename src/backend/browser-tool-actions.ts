import type { BrowserTarget } from "@openbot/contracts/ipc";
import type { BrowserCdpEngine } from "./browser-cdp";
import type { BrowserToolCall } from "./browser-tools";

export interface BrowserDynamicToolHooks {
  onUploadTargetResolved?: (inputId: string, documentId: string) => void;
  onUploadAssigned?: (inputId: string, documentId: string) => void;
  onUploadOperationStarted?: (completion: Promise<void>) => void;
}

type BrowserInputCall = Extract<
  BrowserToolCall,
  {
    tool: "click" | "type" | "press" | "hover" | "scroll" | "select_option" | "set_checked" | "drag" | "upload_files";
  }
>;

interface BrowserInputAction {
  name: string;
  target: BrowserTarget | undefined;
  run(engine: BrowserCdpEngine, deadline: number, markDispatched: () => void): Promise<void>;
}

/** Owns typed input dispatch. The host owns tab authorization, queues, focus, and deadlines. */
export function browserInputAction(call: BrowserInputCall, hooks: BrowserDynamicToolHooks): BrowserInputAction {
  switch (call.tool) {
    case "click": {
      const { args } = call;
      return {
        name: "click",
        target: args.target,
        run: (engine, deadline, markDispatched) =>
          engine.click(
            args.target,
            {
              button: args.button,
              clickCount: args.clickCount,
              modifiers: args.modifiers,
            },
            deadline,
            markDispatched,
          ),
      };
    }
    case "type": {
      const { args } = call;
      return {
        name: "type",
        target: args.target,
        run: (engine, deadline, markDispatched) =>
          engine.type(
            args.target,
            args.text,
            {
              mode: args.mode ?? "replace",
              submit: args.submit === true,
            },
            deadline,
            markDispatched,
          ),
      };
    }
    case "press": {
      const { args } = call;
      return {
        name: "press",
        target: args.target,
        run: (engine, deadline, markDispatched) => engine.press(args.key, args.target, deadline, markDispatched),
      };
    }
    case "hover": {
      const { args } = call;
      return {
        name: "hover",
        target: args.target,
        run: (engine, deadline, markDispatched) => engine.hover(args.target, deadline, markDispatched),
      };
    }
    case "scroll": {
      const { args } = call;
      const deltaX = args.deltaX ?? 0;
      const deltaY = args.deltaY ?? 0;
      if (deltaX === 0 && deltaY === 0) throw new Error("scroll requires deltaX or deltaY.");
      return {
        name: "scroll",
        target: args.target,
        run: (engine, deadline, markDispatched) => engine.scroll(args.target, deltaX, deltaY, deadline, markDispatched),
      };
    }
    case "select_option": {
      const { args } = call;
      return {
        name: "select-option",
        target: args.target,
        run: (engine, deadline, markDispatched) =>
          engine.selectOption(args.target, args.values, deadline, markDispatched),
      };
    }
    case "set_checked": {
      const { args } = call;
      return {
        name: "set-checked",
        target: args.target,
        run: (engine, deadline, markDispatched) =>
          engine.setChecked(args.target, args.checked, deadline, markDispatched),
      };
    }
    case "drag": {
      const { args } = call;
      return {
        name: "drag",
        target: args.source,
        run: (engine, deadline, markDispatched) => engine.drag(args.source, args.target, deadline, markDispatched),
      };
    }
    case "upload_files": {
      const { args } = call;
      return {
        name: "upload-files",
        target: args.target,
        run: async (engine, deadline, markDispatched) => {
          const assignment = await engine.uploadFiles(
            args.target,
            args.paths,
            (resolved) => hooks.onUploadTargetResolved?.(resolved.inputId, resolved.documentId),
            deadline,
            markDispatched,
          );
          hooks.onUploadAssigned?.(assignment.inputId, assignment.documentId);
        },
      };
    }
  }
}

export function browserToolTimeout(timeoutMs: number | undefined): number {
  return Math.max(1, timeoutMs ?? 10_000);
}
