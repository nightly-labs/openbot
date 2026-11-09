import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/uiBlock";

export const messages = {
  "uiBlock.status.answered": "已回答",
  "uiBlock.status.waiting": "等待你操作",
  "uiBlock.outcome.expired": "超时未回答",
  "uiBlock.outcome.closed": "未回答即关闭",
  "uiBlock.outcome.autoAnswered": "{outcome}（无人及时回答）",
  "uiBlock.confirm.holdHint": "按住按钮确认，或点一下在第二步确认",
  "uiBlock.confirm.prompt": "确认：{action}？",
  "uiBlock.confirm.accept": "确认",
  "uiBlock.confirm.autoActionLabel": "{action} · {seconds} 秒",
  "uiBlock.confirm.autoActionClock": "{action} · {time}",
  "uiBlock.confirm.previewLabel": "预览",
  "uiBlock.confirm.showFullPreview": "显示全部",
  "uiBlock.confirm.hideFullPreview": "收起",
  "uiBlock.choice.submit": "发送",
  "uiBlock.choice.shortcutHint": "按 {first} 到 {last} 选择",
  "uiBlock.quick.label": "快捷回复",
  "uiBlock.form.submit": "提交",
  "uiBlock.form.required": "该项为必填",
  "uiBlock.form.choose": "请选择一个选项",
  "uiBlock.form.notSet": "未设置",
  "uiBlock.form.invalid": "有些回答不正确，请检查后重试。",
  "uiBlock.form.hiddenValue": "已隐藏",
  "uiBlock.skip": "跳过",
  "uiBlock.error.answerFailed": "回答没能发送出去，请重试。",
} as const satisfies PartialTranslation<typeof source>;
