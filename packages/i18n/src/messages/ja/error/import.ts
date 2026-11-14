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
  "error.import.fileRenamed": "{name}: {file} はすでに存在するため、このコピーを {saved} として保存します。",
  "error.import.fileSkipped": "{name}: ファイル {file} をスキップします。{reason}",
  "error.import.chooseZip": ".zip ファイルを選択してください。",
  "error.import.unsafeFile": "エクスポートに安全でないファイルが含まれています: {name}",
  "error.import.tooManyFiles": "エクスポートのファイル数は {limit} 以下である必要があります。",
  "error.import.diskSpace":
    "{name}: ファイルには {size} GB の空きディスク容量が必要ですが、空きは {free} GB です。空き容量を確保してから、エージェントをもう一度インポートしてください。",
  "error.import.remoteExpandedTooLarge":
    "エクスポートは展開後に 500 MB 未満かつ {limit} ファイル未満である必要があります。",
  "error.import.zipInvalid":
    "選択したファイルは有効な .zip ではありません。Grok Bot がまだ保存中の場合は、待ってからもう一度選択してください。",
  "error.import.entryDamaged": "エクスポート内のファイルが破損しています。",
  "error.import.foldersSkipped":
    ".git と node_modules フォルダー内の {number} 個のファイルは除外されます。ツールで再作成できます。",
  "error.import.empty": "エクスポートが空です。",
  "error.import.remoteZipTooLarge":
    "参加しているサーバーにインポートするには、エクスポートは 100 MB 未満の .zip である必要があります。",
  "error.import.hostBusy": "サーバーは他のエクスポートを読み込み中です。数分後にもう一度お試しください。",
  "error.import.uploadDiskSpace":
    "このエクスポートにはサーバーに {size} GB の空き容量が必要ですが、空きは {free} GB です。サーバーの空き容量を増やしてから、もう一度エクスポートを選んでください。",
  "error.import.remoteZipTooLargeOldHost":
    "このサーバーが受け付けるエクスポートは 100 MB までです。より大きなエクスポートをインポートするには、サーバーの OpenBot をアップデートしてください。",
  "error.import.skillKept":
    "{name}: サーバーにはすでにスキル「{skill}」があるため、エージェントはそのスキルを使います。更新は管理者に依頼してください。",
  "error.import.skillRenamed":
    "{name}: スキル「{skill}」の名前は別のスキルの名前に似すぎているため、「{renamed}」として保存されます。",
  "error.import.transferRemoteTooLarge":
    "参加しているサーバーの移行ファイルは 100 MB 未満である必要があります。ワークスペースのファイルをオフにするか、エクスポートするエージェントを減らしてください。",
  "error.import.transferNotFile": "このファイルは OpenBot の移行ファイルではありません。",
  "error.import.transferNewer":
    "このファイルは新しいバージョンの OpenBot で作成されました。OpenBot をアップデートしてから、もう一度お試しください。",
  "error.import.transferEmpty": "このファイルにはエージェントも設定も含まれていません。",
  "error.import.transferTooLarge":
    "移行ファイルは 2 GB 未満、かつ 50,000 ファイル未満である必要があります。ワークスペースのファイルをオフにするか、エクスポートするエージェントを減らしてください。",
  "error.import.transferAgentInvalid": "ファイル内のエージェント {number} は無効なため、スキップされます。",
  "error.import.transferSettingsInvalid": "ファイル内のアプリ設定は無効なため、インポートされません。",
  "error.import.transferModelMissing":
    "{name}: モデル「{model}」はまだここで利用できないため、エージェントはデフォルトのモデルを使います。プロバイダーの準備ができたら、モデルを選択し直してください。",
  "error.import.transferSettingSkipped": "{name} はインポートされません。{reason}",
  "error.import.transferRunsSkipped": "{name}: ルーティン「{routine}」の実行履歴はインポートされません。",
  "error.import.transferSharedSkillsSkipped": "共有スキルを読み込めなかったため、ファイルに含まれていません。",
  "error.import.transferSharedSkillsNotAdded": "ファイル内の共有スキルをこのサーバーに追加できませんでした。",
  "error.import.transferMemberPreferencesSkipped": {
    other: "{count} 人のメンバーの選択を保存できませんでした。",
  },
  "error.import.transferSharedSkillExists":
    "同じ名前で異なるファイルを持つ共有スキルが、このサーバーにすでにあります。",
  "error.import.transferServerPreferencesSkipped": {
    other: "ファイル内のサーバーの環境設定 {count} 件はここでは無効なため、インポートされません。",
  },
  "error.import.transferRoutineFlowSkipped": "インポートでルーティンフローが 1 つ除外されました。{reason}",
  "error.import.transferCustomAgentCommand":
    "{name}: カスタムエージェントはコマンドを実行するため、インポートされません。コマンド「{command}」を確認し、設定でエージェントを追加し直してください。",
  "error.import.transferSkillLimit":
    "{name}: エージェントが持てるスキルは {limit} 個までのため、{total} 個のスキルのうち最初の {limit} 個だけがファイルに含まれています。",
  "error.import.transferFilesGone":
    "エクスポートの実行中に {number} 個のファイルが削除されたため、ファイルに含まれていません。",
  "error.import.transferProviderKey": "{name}: 設定で API キーを入力し直してください。",
  "error.import.transferAgentEnv": "{name}: 設定で {names} の値を入力し直してください。",
  "error.import.transferMcpValues":
    "{name}: MCP サーバーはオフの状態で追加されます。コマンドを確認し、値と完全なアドレスを入力し直してから、MCP の設定でオンにしてください。",
  "error.import.transferValuesCleared":
    "{name}: シークレットを含む可能性のある値が、引数またはアドレスから削除されました。設定で入力し直してください。",
  "error.import.transferSharedKept":
    "共有フォルダー内の {number} 個のファイルはすでにここにあるため、そのまま保持されます。",
} as const satisfies PartialTranslation<typeof source>;
