import type { BrowserControlAction, BrowserControlDetailAction } from "@openbot/contracts/ipc";
import type { BrowserToolCall } from "./browser-tools";

export function controlSessionId(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}

export function browserControlAction(call: BrowserToolCall): BrowserControlAction {
  switch (call.tool) {
    case "open":
      return "open";
    case "list_tabs":
      return "list-tabs";
    case "snapshot":
      return "snapshot";
    case "screenshot":
      return "screenshot";
    case "close_tab":
      return "close-tab";
    case "status":
      return "list-tabs";
    case "navigate":
      if (call.args.direction === "back") return "back";
      if (call.args.direction === "forward") return "forward";
      if (call.args.direction === "reload") return "reload";
      return "open";
    case "click":
      return "click";
    case "type":
      return "type";
    case "press":
      return "key";
    case "hover":
      return "click";
    case "scroll":
      return "scroll";
    case "select_option":
      return "click";
    case "set_checked":
      return "click";
    case "drag":
      return "click";
    case "upload_files":
      return "type";
    case "wait_for":
      return "snapshot";
    case "evaluate":
      return "snapshot";
    case "set_environment":
      return "snapshot";
    case "recording_start":
      return "screenshot";
    case "recording_stop":
      return "screenshot";
    case "act":
      return call.args.action.type;
    default:
      return "snapshot";
  }
}

export function browserControlDetailAction(tool: string): BrowserControlDetailAction | undefined {
  switch (tool) {
    case "status":
    case "navigate":
    case "press":
    case "hover":
    case "drag":
      return tool;
    case "select_option":
      return "select-option";
    case "set_checked":
      return "set-checked";
    case "upload_files":
      return "upload-files";
    case "wait_for":
      return "wait-for";
    case "evaluate":
      return "evaluate";
    case "set_environment":
      return "set-environment";
    case "recording_start":
      return "recording-start";
    case "recording_stop":
      return "recording-stop";
    default:
      return undefined;
  }
}
