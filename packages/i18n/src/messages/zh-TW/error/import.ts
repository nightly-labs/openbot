import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  // Agent import errors and warnings.
  "error.import.manifestNotJson": "{manifest} 不是有效的 JSON。",
  "error.import.notAgentExport": "{manifest} 不是 OpenBot 助理匯出檔案。",
  "error.import.newerExportSkill": "該匯出由更新版本的匯出技能生成，請更新 OpenBot 後重試。",
  "error.import.noAgents": "該匯出中沒有任何助理。",
  "error.import.tooManyAgents": "該匯出中的助理超過 {limit} 個。",
  "error.import.tooManyChannels": "該匯出中的頻道超過 {limit} 個。",
  "error.import.channelSkipped": "{name}：該頻道的助理都不在匯出中，已跳過。",
  "error.import.membersLeftOut": "{name}：不屬於本次匯出中助理的成員已被略過。",
  "error.import.leadNotMember": "{name}：負責人不是成員，因此該頻道沒有負責人。",
  "error.import.routineLimit": "{name}：只匯入前 {limit} 個自動化任務。",
  "error.import.routineInvalid": "{name}：自動化任務「{routine}」的名稱、文字或計劃無效，已跳過。",
  "error.import.memoriesSkipped": "{name}：有 {skipped} 條記憶因內容為空或超過 {limit} 個字元而被跳過。",
  "error.import.memoryLimit": "{name}：只匯入前 {limit} 條記憶。",
  "error.import.manifestMissing": "匯出檔案必須包含 {manifest}。",
  "error.import.skillFolderMissing": "{name}：技能資料夾 {skill} 中沒有 SKILL.md。",
  "error.import.avatarSkipped": "{name}：頭像不是小於 512 KB 的 PNG、JPEG 或 WebP，已跳過。",
  "error.import.exportClosed": "該匯出已關閉，請重新選擇。",
  "error.import.agentNotInExport": "所選內容指向了不在匯出中的助理。",
  "error.import.channelNotInExport": "所選內容指向了不在匯出中的頻道。",
  "error.import.serverAgentLimit": "一個伺服器最多可有 {limit} 個助理。",
  "error.import.exportChanged": "匯出在檢查之後發生了變更，請重新選擇。",
  "error.import.noMembersImported": "它的助理一個都沒有匯入。",
  "error.import.leadNotImported": "{name}：其負責人未匯入，因此它沒有負責人。",
  "error.import.routineSkipped": "{name}：自動化任務「{routine}」已跳過。{reason}",
  "error.import.fileRenamed": "{name}：{file} 已存在，該副本將儲存為 {saved}。",
  "error.import.fileSkipped": "{name}：檔案 {file} 已跳過。{reason}",
  "error.import.chooseZip": "請選擇 .zip 檔案。",
  "error.import.zipTooLarge": "匯出檔案必須是小於 500 MB 的 .zip。",
  "error.import.unsafeFile": "匯出檔案包含不安全的檔案：{name}",
  "error.import.expandedTooLarge": "解壓後必須小於 500 MB 且檔案數不超過 {limit}。",
  "error.import.zipInvalid": "所選檔案不是有效的 .zip。如果 Grok Bot 仍在儲存，請稍等後重新選擇。",
  "error.import.empty": "該匯出為空。",
  "error.import.remoteZipTooLarge": "匯入到已加入的伺服器時，匯出檔案必須是小於 100 MB 的 .zip。",
  "error.import.hostBusy": "伺服器正在讀取其他匯出，請幾分鐘後重試。",
  "error.import.skillKept": "{name}：伺服器已有技能「{skill}」，因該助理會使用該技能。請聯絡管理員更新它。",
  // Hermes Agent import from a folder on this computer.
  "error.import.hermesNoProfiles": "該資料夾中沒有 Hermes 配置。請選擇包含 config.yaml 或 SOUL.md 的 Hermes 資料夾。",
  "error.import.hermesClosed": "這些 Hermes 配置已不再開啟，請重新讀取。",
  "error.import.hermesProfileMissing": "所選內容指向一個未被讀取的 Hermes 配置。",
  "error.import.hermesSoulLong":
    "{name}：SOUL.md 超過 {limit} 個字元，因此指令只保留開頭部分。完整檔案在 imported/hermes/SOUL.md。",
  "error.import.hermesSkillSkipped": "{name}：已跳過技能「{skill}」。{reason}",
  "error.import.hermesSkillCodeAdded": "它含有讀取這些配置時還沒有的程式碼。請重新讀取以允許它。",
  "error.import.hermesLinkNotSaved": "{name}：OpenBot 無法儲存哪個助理來自該配置，因此下次匯入會把它作為新助理新增。",
  // Instance transfer between two OpenBot computers.
  "error.import.transferRemoteTooLarge":
    "已加入伺服器的遷移檔案必須小於 100 MB。請關閉工作區檔案，或減少匯出的助理數量。",
  "error.import.transferNotFile": "該檔案不是 OpenBot 遷移檔案。",
  "error.import.transferNewer": "該檔案由更新版本的 OpenBot 生成，請更新 OpenBot 後重試。",
  "error.import.transferEmpty": "該檔案既沒有助理也沒有設定。",
  "error.import.transferTooLarge":
    "遷移檔案必須小於 2 GB 且檔案數不超過 50,000。請關閉工作區檔案，或減少匯出的助理數量。",
  "error.import.transferAgentInvalid": "檔案中的第 {number} 個助理無效，已跳過。",
  "error.import.transferSettingsInvalid": "檔案中的應用設定無效，因此未匯入。",
  "error.import.transferModelMissing":
    "{name}：模型「{model}」在此處暫不可用，助理將使用預設模型。待其供應商就緒後請重新選擇該模型。",
  "error.import.transferSettingSkipped": "{name} 未匯入。{reason}",
  "error.import.transferRoutineFlowSkipped": "匯入時略過了一個自動化任務流程。{reason}",
  "error.import.transferCustomAgentCommand":
    "{name}：自定義助理不會匯入，因為它們需要執行命令。請檢查命令「{command}」，並在設定中重新新增該助理。",
  "error.import.transferSkillLimit":
    "{name}：它的 {total} 個技能只有前 {limit} 個放入了檔案，因為一個助理最多可有 {limit} 個技能。",
  "error.import.transferFilesGone": "匯出過程中有 {number} 個檔案被刪除，因此不在檔案中。",
  "error.import.transferProviderKey": "{name}：請在設定中重新輸入它的 API 金鑰。",
  "error.import.transferAgentEnv": "{name}：請在設定中重新輸入 {names} 的值。",
  "error.import.transferMcpValues":
    "{name}：MCP 伺服器以關閉狀態新增。請檢查其命令，重新輸入其取值和完整地址，然後在 MCP 設定中開啟。",
  "error.import.transferValuesCleared": "{name}：可能包含金鑰的取值已從其引數或地址中移除，請在設定中重新輸入。",
  "error.import.transferSharedKept": "共享資料夾中已有 {number} 個同名檔案，因此保持原樣。",
} as const satisfies PartialTranslation<typeof source>;
