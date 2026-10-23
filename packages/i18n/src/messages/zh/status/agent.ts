import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside": "写入 {path}，位置在助手工作区、共享文件夹和临时文件夹之外。",
  "status.agent.contextCleared": "上下文已清空，将从这里开始新对话。",
  "status.agent.modelSwitchedForLimit": "额度已用完，已切换到 {model}。",
  "status.agent.modelReturnedAfterLimit": "额度已恢复，已切回 {model}。",
  "status.agent.marketplaceSuggested": "推荐了一个市场应用：{app}。",
  "status.agent.screenCaptureScreen": "截取主屏幕，并把图像发送给助手的模型。",
  "status.agent.screenCaptureDisplay": "截取显示器 {name}，并把图像发送给助手的模型。",
  "status.agent.screenCaptureWindow": "截取窗口 {name}，并把图像发送给助手的模型。",
  "status.agent.screenCaptureRegion": "截取 {x}、{y} 处 {width} × {height} 点的屏幕区域，并把图像发送给助手的模型。",
  "status.agent.screenCaptureProgress": "正在请求截屏…",
  "status.agent.screenCaptureReviewing": "正在查看截屏…",
} as const satisfies PartialTranslation<typeof source>;
