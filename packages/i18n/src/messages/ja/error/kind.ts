import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "接続できませんでした。接続を確認して、もう一度お試しください。",
  "error.kind.timeout":
    "リクエストに時間がかかりすぎました。操作が完了したかどうかを確認してから、もう一度お試しください。",
  "error.kind.storage":
    "ストレージの空き容量が不足しています。OpenBot を実行しているコンピューターの空き容量を増やしてから、もう一度お試しください。",
  "error.kind.filePermission":
    "OpenBot にはこの操作を行う権限がありません。ファイルまたはフォルダーの権限を確認して、もう一度お試しください。",
  "error.kind.notFound":
    "必要なファイルまたはフォルダーが見つかりません。元に戻すか別のものを選択して、もう一度お試しください。",
  "error.kind.readOnly":
    "このフォルダーは読み取り専用です。書き込み可能なフォルダーを選択して、もう一度お試しください。",
  "error.kind.conflict": "同じ名前の項目がすでに存在します。別の名前を選択して、もう一度お試しください。",
  "error.kind.auth": "認証に失敗しました。アカウントまたはサーバーへの接続を確認して、もう一度お試しください。",
  "error.kind.permission": "この操作を行う権限がありません。所有者にアクセスを依頼してください。",
  "error.kind.rateLimit": "リクエストが多すぎます。しばらく待ってから、もう一度お試しください。",
  "error.kind.service": "サービスを利用できません。しばらく待ってから、もう一度お試しください。",
  "error.kind.clock":
    "OpenBot を実行しているコンピューターの日付または時刻が正しくない可能性があるため、安全な接続に失敗しました。日付と時刻を修正してから、もう一度お試しください。",
} as const satisfies PartialTranslation<typeof source>;
