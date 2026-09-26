import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  // Agent marketplace and agent link errors.
  "error.marketplace.timezoneInvalid": "ローカルのタイムゾーンが無効です。",
  "error.marketplace.installedAgentMissing": "インストール済みのエージェントはもう存在しません。",
  "error.marketplace.differentListing":
    "このローカルエージェントは、別のマーケットプレイスのエージェントからインストールされました。",
  "error.marketplace.marketplaceAvatarInvalid": "マーケットプレイスのエージェントのアバターが無効です。",
  "error.marketplace.shareCardInvalid": "共有カードが無効です。",
  "error.marketplace.cannotPublish": "このエージェントは公開できません。",
  "error.marketplace.templateName": { other: "このエージェントに 1〜{count} 文字の名前を付けてください。" },
  "error.marketplace.templateRole": { other: "役割が {count} 文字を超えています。短くしてください。" },
  "error.marketplace.templateNoInstructions": "公開する前に、このエージェントに指示を追加してください。",
  "error.marketplace.templateInstructions": { other: "指示が {count} 文字を超えています。短くしてください。" },
  "error.marketplace.templateAvatar":
    "このエージェントのアバターが無効です。エージェントの設定でもう一度選んでください。",
  "error.marketplace.templateSkills": {
    other: "エージェントが公開できるスキルは {count} 個までです。いくつか削除してください。",
  },
  "error.marketplace.templateLocalSkills": {
    other: "エージェントが公開できるローカルスキルは {count} 個までです。いくつか削除してください。",
  },
  "error.marketplace.templateSkill": "スキル「{name}」は公開できません。名前と SKILL.md を確認してください。",
  "error.marketplace.templateRoutines": {
    other: "エージェントが公開できるルーティンは {count} 個までです。いくつか削除してください。",
  },
  "error.marketplace.templateRoutine": {
    other: "ルーティン「{name}」には {count} 文字以内の名前と指示が必要です。",
  },
  "error.marketplace.templateRoutineNoName": "名前なし",
  "error.marketplace.templateTooLarge":
    "このエージェントは大きすぎるため公開できません。指示、スキル、ルーティンを短くしてください。",
  "error.marketplace.linkInvalid": "エージェントのリンクが無効です。",
  "error.marketplace.changedSinceOpened":
    "このエージェントは開いた後に変更されました。新しいバージョンを確認するには、リンクをもう一度開いてください。",
  "error.marketplace.skillNameConflict":
    "「{name}」という名前の別のローカルスキルがすでにあります。名前を変更するか削除してから、このエージェントをもう一度追加してください。",
  "error.marketplace.avatarInvalid": "エージェントのアバターが無効です。",
  "error.marketplace.secretInName": "公開する前に、名前からシークレットまたはメールアドレスを削除してください。",
  "error.marketplace.secretInTitle": "公開する前に、タイトルからシークレットまたはメールアドレスを削除してください。",
  "error.marketplace.secretInInstructions":
    "公開する前に、指示からシークレットまたはメールアドレスを削除してください。",
  "error.marketplace.secretInRoutine":
    "公開する前に、ルーティン「{name}」からシークレットまたはメールアドレスを削除してください。",
  "error.marketplace.secretInSkill":
    "公開する前に、スキル「{name}」からシークレットまたはメールアドレスを削除してください。",
} as const satisfies PartialTranslation<typeof source>;
