import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  // Agent import errors and warnings.
  "error.import.manifestNotJson": "{manifest} は有効な JSON ではありません。",
  "error.import.notAgentExport": "{manifest} は OpenBot のエージェントのエクスポートではありません。",
  "error.import.newerExportSkill":
    "このエクスポートは、より新しいエクスポート用スキルで作成されました。OpenBot をアップデートしてから、もう一度お試しください。",
  "error.import.noAgents": "エクスポートにエージェントが含まれていません。",
  "error.import.tooManyAgents": "エクスポートに含まれるエージェントが {limit} 個を超えています。",
  "error.import.tooManyChannels": "エクスポートに含まれるチャンネルが {limit} 個を超えています。",
  "error.import.channelSkipped":
    "{name}: このチャンネルのエージェントがエクスポートに含まれていないため、チャンネルをスキップします。",
  "error.import.membersLeftOut": "{name}: このエクスポートのエージェントではないメンバーは除外します。",
  "error.import.leadNotMember": "{name}: リーダーがメンバーではないため、このチャンネルにはリーダーがいません。",
  "error.import.routineLimit": "{name}: 最初の {limit} 個のルーティンのみをインポートします。",
  "error.import.routineInvalid":
    "{name}: 名前、テキスト、またはスケジュールが無効なため、ルーティン「{routine}」をスキップします。",
  "error.import.memoriesSkipped":
    "{name}: 空であるか {limit} 文字を超えるため、{skipped} 件のメモリーをスキップします。",
  "error.import.memoryLimit": "{name}: 最初の {limit} 件のメモリーのみをインポートします。",
  "error.import.manifestMissing": "エクスポートには {manifest} が必要です。",
  "error.import.skillFolderMissing": "{name}: スキルフォルダー {skill} に SKILL.md がありません。",
  "error.import.avatarSkipped": "{name}: 512 KB 未満の PNG、JPEG、WebP ではないため、アバターをスキップします。",
  "error.import.exportClosed": "エクスポートはもう開かれていません。もう一度選択してください。",
  "error.import.agentNotInExport": "選択に、エクスポートに含まれていないエージェントがあります。",
  "error.import.channelNotInExport": "選択に、エクスポートに含まれていないチャンネルがあります。",
  "error.import.serverAgentLimit": "サーバーに追加できるエージェントは {limit} 個までです。",
  "error.import.exportChanged": "確認後にエクスポートが変更されました。もう一度選択してください。",
  "error.import.noMembersImported": "このチャンネルのエージェントは 1 つもインポートされませんでした。",
  "error.import.leadNotImported": "{name}: リーダーがインポートされなかったため、リーダーがいません。",
  "error.import.routineSkipped": "{name}: ルーティン「{routine}」をスキップします。{reason}",
  "error.import.chooseZip": ".zip ファイルを選択してください。",
  "error.import.zipTooLarge": "エクスポートは 500 MB 未満の .zip である必要があります。",
  "error.import.unsafeFile": "エクスポートに安全でないファイルが含まれています: {name}",
  "error.import.expandedTooLarge": "エクスポートは展開後に 500 MB 未満かつ {limit} ファイル未満である必要があります。",
  "error.import.zipInvalid":
    "選択したファイルは有効な .zip ではありません。Grok Bot がまだ保存中の場合は、待ってからもう一度選択してください。",
  "error.import.empty": "エクスポートが空です。",
} as const satisfies PartialTranslation<typeof source>;
