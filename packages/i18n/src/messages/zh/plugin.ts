import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  // The plugin page in the marketplace.
  "plugin.link.website": "网站",
  "plugin.link.privacyPolicy": "隐私政策",
  "plugin.link.terms": "服务条款",
  "plugin.copyLink": "复制链接",
  "plugin.askPrompt": "向 {name} 提问：{prompt}",
  "plugin.section.skills": "技能",
  "plugin.section.information": "信息",
  "plugin.info.developer": "开发者",
  "plugin.info.category": "分类",
  "plugin.info.version": "版本",

  // The uninstall confirmation. {number} is a count that has no plural form here.
  "plugin.uninstallDialog.title": "断开 {name}？",
  "plugin.uninstallDialog.description": "这会移除 {name} 在这台电脑上安装的内容，该主机和该助手的其他内容不受影响。",
  "plugin.uninstallDialog.confirm": "断开连接",
  "plugin.uninstallDialog.appsLabel": "要移除的应用，{number}",
  "plugin.uninstallDialog.appsTitle": "从此主机移除的应用",
  "plugin.uninstallDialog.appsNote": "它们的工具将不可用，OpenBot 为它们保存的登录信息也会被遗忘。",
  "plugin.uninstallDialog.skillsLabel": "要移除的技能，{number}",
  "plugin.uninstallDialog.skillsTitle": "从 {agentName} 移除的技能",
} as const satisfies PartialTranslation<typeof source>;
