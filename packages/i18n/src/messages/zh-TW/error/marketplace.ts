import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  // Agent marketplace and agent link errors.
  "error.marketplace.timezoneInvalid": "本地時區無效。",
  "error.marketplace.installedAgentMissing": "已安裝的助理已不存在。",
  "error.marketplace.differentListing": "該本地助理是從另一個市場助理安裝的。",
  "error.marketplace.marketplaceAvatarInvalid": "市場助理的頭像無效。",
  "error.marketplace.shareCardInvalid": "分享卡片無效。",
  "error.marketplace.cannotPublish": "該助理無法釋出。",
  "error.marketplace.templateName": {
    one: "請把該助理的名稱設為 1 到 {count} 個字元。",
    other: "請把該助理的名稱設為 1 到 {count} 個字元。",
  },
  "error.marketplace.templateRole": {
    one: "稱號超過 {count} 個字元，請縮短。",
    other: "稱號超過 {count} 個字元，請縮短。",
  },
  "error.marketplace.templateNoInstructions": "釋出前請先為該助理新增指令。",
  "error.marketplace.templateInstructions": {
    one: "指令超過 {count} 個字元，請縮短。",
    other: "指令超過 {count} 個字元，請縮短。",
  },
  "error.marketplace.templateAvatar": "該助理的頭像無效，請在助理設定中重新選擇。",
  "error.marketplace.templateSkills": {
    one: "一個助理最多可釋出 {count} 個技能，請移除一些。",
    other: "一個助理最多可釋出 {count} 個技能，請移除一些。",
  },
  "error.marketplace.templateLocalSkills": {
    one: "一個助理最多可釋出 {count} 個本地技能，請移除一些。",
    other: "一個助理最多可釋出 {count} 個本地技能，請移除一些。",
  },
  "error.marketplace.templateSkill": "技能「{name}」無法釋出，請檢查它的名稱和 SKILL.md。",
  "error.marketplace.templateRoutines": {
    one: "一個助理最多可釋出 {count} 個自動化任務，請移除一些。",
    other: "一個助理最多可釋出 {count} 個自動化任務，請移除一些。",
  },
  "error.marketplace.templateRoutine": {
    one: "自動化任務「{name}」需要不超過 {count} 個字元的名稱和一條指令。",
    other: "自動化任務「{name}」需要不超過 {count} 個字元的名稱和一條指令。",
  },
  // Fills `{name}` above when the routine has no name.
  "error.marketplace.templateRoutineNoName": "未命名",
  "error.marketplace.templateTooLarge": "該助理體積過大無法釋出，請精簡其指令、技能或自動化任務。",
  "error.marketplace.linkInvalid": "助理鍊接無效。",
  "error.marketplace.changedSinceOpened": "該助理在你開啟之後發生了變化，請重新開啟連結檢視新版本。",
  "error.marketplace.skillNameConflict": "你已有一個不同的同名本地技能「{name}」，請重新命名或移除它後再新增該助理。",
  "error.marketplace.avatarInvalid": "助理頭像無效。",
  "error.marketplace.secretInName": "釋出前請從名稱中移除金鑰或電子郵件地址。",
  "error.marketplace.secretInTitle": "釋出前請從稱號中移除金鑰或電子郵件地址。",
  "error.marketplace.secretInInstructions": "釋出前請從指令中移除金鑰或電子郵件地址。",
  "error.marketplace.secretInRoutine": "釋出前請從自動化任務「{name}」中移除金鑰或電子郵件地址。",
  "error.marketplace.secretInSkill": "釋出前請從技能「{name}」中移除金鑰或電子郵件地址。",
  "error.marketplace.catalogLoadFailed": "無法載入市場，請重試。",
  "error.marketplace.templateUnreadable": "無法讀取該共享助理，其所有者可能已將其移除。",
} as const satisfies PartialTranslation<typeof source>;
