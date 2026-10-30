import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  // Agent import errors and warnings.
  "error.import.manifestNotJson": "{manifest} 不是有效的 JSON。",
  "error.import.notAgentExport": "{manifest} 不是 OpenBot 助手导出文件。",
  "error.import.newerExportSkill": "该导出由更新版本的导出技能生成，请更新 OpenBot 后重试。",
  "error.import.noAgents": "该导出中没有任何助手。",
  "error.import.tooManyAgents": "该导出中的助手超过 {limit} 个。",
  "error.import.tooManyChannels": "该导出中的频道超过 {limit} 个。",
  "error.import.channelSkipped": "{name}：该频道的助手都不在导出中，已跳过。",
  "error.import.membersLeftOut": "{name}：不属于本次导出中助手的成员已被略过。",
  "error.import.leadNotMember": "{name}：负责人不是成员，因此该频道没有负责人。",
  "error.import.routineLimit": "{name}：只导入前 {limit} 个自动化任务。",
  "error.import.routineInvalid": "{name}：自动化任务“{routine}”的名称、文本或计划无效，已跳过。",
  "error.import.memoriesSkipped": "{name}：有 {skipped} 条记忆因内容为空或超过 {limit} 个字符而被跳过。",
  "error.import.memoryLimit": "{name}：只导入前 {limit} 条记忆。",
  "error.import.manifestMissing": "导出文件必须包含 {manifest}。",
  "error.import.skillFolderMissing": "{name}：技能文件夹 {skill} 中没有 SKILL.md。",
  "error.import.avatarSkipped": "{name}：头像不是小于 512 KB 的 PNG、JPEG 或 WebP，已跳过。",
  "error.import.exportClosed": "该导出已关闭，请重新选择。",
  "error.import.agentNotInExport": "所选内容指向了不在导出中的助手。",
  "error.import.channelNotInExport": "所选内容指向了不在导出中的频道。",
  "error.import.serverAgentLimit": "一个服务器最多可有 {limit} 个助手。",
  "error.import.exportChanged": "导出在检查之后发生了变更，请重新选择。",
  "error.import.noMembersImported": "它的助手一个都没有导入。",
  "error.import.leadNotImported": "{name}：其负责人未导入，因此它没有负责人。",
  "error.import.routineSkipped": "{name}：自动化任务“{routine}”已跳过。{reason}",
  "error.import.fileRenamed": "{name}：{file} 已存在，该副本将保存为 {saved}。",
  "error.import.fileSkipped": "{name}：文件 {file} 已跳过。{reason}",
  "error.import.chooseZip": "请选择 .zip 文件。",
  "error.import.zipTooLarge": "导出文件必须是小于 500 MB 的 .zip。",
  "error.import.unsafeFile": "导出文件包含不安全的文件：{name}",
  "error.import.expandedTooLarge": "解压后必须小于 500 MB 且文件数不超过 {limit}。",
  "error.import.zipInvalid": "所选文件不是有效的 .zip。如果 Grok Bot 仍在保存，请稍等后重新选择。",
  "error.import.empty": "该导出为空。",
  "error.import.remoteZipTooLarge": "导入到已加入的服务器时，导出文件必须是小于 100 MB 的 .zip。",
  "error.import.hostBusy": "服务器正在读取其他导出，请几分钟后重试。",
  "error.import.skillKept": "{name}：服务器已有技能“{skill}”，因该助手会使用该技能。请联系管理员更新它。",
  // Hermes Agent import from a folder on this computer.
  "error.import.hermesNoProfiles": "该文件夹中没有 Hermes 配置。请选择包含 config.yaml 或 SOUL.md 的 Hermes 文件夹。",
  "error.import.hermesClosed": "这些 Hermes 配置已不再打开，请重新读取。",
  "error.import.hermesProfileMissing": "所选内容指向一个未被读取的 Hermes 配置。",
  "error.import.hermesSoulLong":
    "{name}：SOUL.md 超过 {limit} 个字符，因此指令只保留开头部分。完整文件在 imported/hermes/SOUL.md。",
  "error.import.hermesSkillSkipped": "{name}：已跳过技能“{skill}”。{reason}",
  "error.import.hermesSkillCodeAdded": "它含有读取这些配置时还没有的代码。请重新读取以允许它。",
  "error.import.hermesLinkNotSaved": "{name}：OpenBot 无法保存哪个助手来自该配置，因此下次导入会把它作为新助手添加。",
  // Instance transfer between two OpenBot computers.
  "error.import.transferRemoteTooLarge":
    "已加入服务器的迁移文件必须小于 100 MB。请关闭工作区文件，或减少导出的助手数量。",
  "error.import.transferNotFile": "该文件不是 OpenBot 迁移文件。",
  "error.import.transferNewer": "该文件由更新版本的 OpenBot 生成，请更新 OpenBot 后重试。",
  "error.import.transferEmpty": "该文件既没有助手也没有设置。",
  "error.import.transferTooLarge":
    "迁移文件必须小于 2 GB 且文件数不超过 50,000。请关闭工作区文件，或减少导出的助手数量。",
  "error.import.transferAgentInvalid": "文件中的第 {number} 个助手无效，已跳过。",
  "error.import.transferSettingsInvalid": "文件中的应用设置无效，因此未导入。",
  "error.import.transferModelMissing":
    "{name}：模型“{model}”在此处暂不可用，助手将使用默认模型。待其服务商就绪后请重新选择该模型。",
  "error.import.transferSettingSkipped": "{name} 未导入。{reason}",
  "error.import.transferRoutineFlowSkipped": "导入时略过了一个自动化任务流程。{reason}",
  "error.import.transferCustomAgentCommand":
    "{name}：自定义助手不会导入，因为它们需要运行命令。请检查命令“{command}”，并在设置中重新添加该助手。",
  "error.import.transferSkillLimit":
    "{name}：它的 {total} 个技能只有前 {limit} 个放入了文件，因为一个助手最多可有 {limit} 个技能。",
  "error.import.transferFilesGone": "导出过程中有 {number} 个文件被删除，因此不在文件中。",
  "error.import.transferProviderKey": "{name}：请在设置中重新输入它的 API 密钥。",
  "error.import.transferAgentEnv": "{name}：请在设置中重新输入 {names} 的值。",
  "error.import.transferMcpValues":
    "{name}：MCP 服务器以关闭状态添加。请检查其命令，重新输入其取值和完整地址，然后在 MCP 设置中开启。",
  "error.import.transferValuesCleared": "{name}：可能包含密钥的取值已从其参数或地址中移除，请在设置中重新输入。",
  "error.import.transferSharedKept": "共享文件夹中已有 {number} 个同名文件，因此保持原样。",
} as const satisfies PartialTranslation<typeof source>;
