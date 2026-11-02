import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  // Agent marketplace and agent link errors.
  "error.marketplace.timezoneInvalid": "本地时区无效。",
  "error.marketplace.installedAgentMissing": "已安装的助手已不存在。",
  "error.marketplace.differentListing": "该本地助手是从另一个市场助手安装的。",
  "error.marketplace.marketplaceAvatarInvalid": "市场助手的头像无效。",
  "error.marketplace.shareCardInvalid": "分享卡片无效。",
  "error.marketplace.cannotPublish": "该助手无法发布。",
  "error.marketplace.templateName": {
    one: "请把该助手的名称设为 1 到 {count} 个字符。",
    other: "请把该助手的名称设为 1 到 {count} 个字符。",
  },
  "error.marketplace.templateRole": {
    one: "称号超过 {count} 个字符，请缩短。",
    other: "称号超过 {count} 个字符，请缩短。",
  },
  "error.marketplace.templateNoInstructions": "发布前请先为该助手添加指令。",
  "error.marketplace.templateInstructions": {
    one: "指令超过 {count} 个字符，请缩短。",
    other: "指令超过 {count} 个字符，请缩短。",
  },
  "error.marketplace.templateAvatar": "该助手的头像无效，请在助手设置中重新选择。",
  "error.marketplace.templateSkills": {
    one: "一个助手最多可发布 {count} 个技能，请移除一些。",
    other: "一个助手最多可发布 {count} 个技能，请移除一些。",
  },
  "error.marketplace.templateLocalSkills": {
    one: "一个助手最多可发布 {count} 个本地技能，请移除一些。",
    other: "一个助手最多可发布 {count} 个本地技能，请移除一些。",
  },
  "error.marketplace.templateSkill": "技能“{name}”无法发布，请检查它的名称和 SKILL.md。",
  "error.marketplace.templateRoutines": {
    one: "一个助手最多可发布 {count} 个自动化任务，请移除一些。",
    other: "一个助手最多可发布 {count} 个自动化任务，请移除一些。",
  },
  "error.marketplace.templateRoutine": {
    one: "自动化任务“{name}”需要不超过 {count} 个字符的名称和一条指令。",
    other: "自动化任务“{name}”需要不超过 {count} 个字符的名称和一条指令。",
  },
  // Fills `{name}` above when the routine has no name.
  "error.marketplace.templateRoutineNoName": "未命名",
  "error.marketplace.templateTooLarge": "该助手体积过大无法发布，请精简其指令、技能或自动化任务。",
  "error.marketplace.linkInvalid": "助手链接无效。",
  "error.marketplace.changedSinceOpened": "该助手在你打开之后发生了变化，请重新打开链接查看新版本。",
  "error.marketplace.skillNameConflict": "你已有一个不同的同名本地技能“{name}”，请重命名或移除它后再添加该助手。",
  "error.marketplace.avatarInvalid": "助手头像无效。",
  "error.marketplace.secretInName": "发布前请从名称中移除密钥或邮箱地址。",
  "error.marketplace.secretInTitle": "发布前请从称号中移除密钥或邮箱地址。",
  "error.marketplace.secretInInstructions": "发布前请从指令中移除密钥或邮箱地址。",
  "error.marketplace.secretInRoutine": "发布前请从自动化任务“{name}”中移除密钥或邮箱地址。",
  "error.marketplace.secretInSkill": "发布前请从技能“{name}”中移除密钥或邮箱地址。",
  "error.marketplace.catalogLoadFailed": "无法加载市场，请重试。",
  "error.marketplace.templateUnreadable": "无法读取该共享助手，其所有者可能已将其移除。",
} as const satisfies PartialTranslation<typeof source>;
