import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/crm";

export const messages = {
  "error.crm.serverTooOld":
    "このサーバーは CRM に対応していません。サーバーを実行しているコンピューターの OpenBot を更新してください。",
  "error.crm.tooLargeToSend": "この CRM ページは大きすぎるため、このクライアントに送信できません。",
  "error.crm.customerMissing": "この顧客はもう存在しません。",
  "error.crm.planMissing": "このプランはもう存在しません。",
  "error.crm.paymentMissing": "この支払いはもう存在しません。",
  "error.crm.tagMissing": "このタグはもう存在しません。",
  "error.crm.statusMissing": "このステータスはもう存在しません。",
  "error.crm.proposalMissing": "この提案はもう存在しないか、すでに判断済みです。",
  "error.crm.tagExists": "この名前のタグはすでに存在します。",
  "error.crm.statusExists": "この名前のステータスはすでに存在します。",
  "error.crm.builtinStatus": "組み込みのステータスは名前の変更も削除もできません。",
  "error.crm.tooManyStatuses": "CRM のステータス数が上限に達しています。先にステータスを削除してください。",
  "error.crm.tooManyTags": "CRM のタグ数が上限に達しています。先にタグを削除してください。",
  "error.crm.tooManyPlans": "この顧客のプラン数が上限に達しています。先にプランを削除してください。",
  "error.crm.paymentPaid": "この支払いは支払い済みです。先に未払いに戻してください。",
  "error.crm.splitTotal": "各部分の合計を支払い金額と一致させてください。",
  "error.crm.planEndsBeforeStart": "プランの終了日を開始日より前にすることはできません。",
  "error.crm.currencyInUse": "プランまたは支払いがある顧客の通貨は変更できません。",
  "error.crm.badCursor": "このページはもう有効ではありません。リストを再読み込みしてください。",
  "error.crm.invalidChange": "この変更は無効です。",
  "error.crm.agentNotAllowed":
    "このエージェントは CRM を使用できません。オーナーまたは管理者がアクセスを許可できます: CRM ページを開き、「提案」をクリックし、エージェント数のボタンをクリックして、このエージェントをオンにします。",
  "error.crm.tooManyProposals": "判断待ちの提案が多すぎます。誰かが判断するまでお待ちください。",
  "error.crm.amountInvalid": "金額は 129.00 のように数値で入力してください。",
  "error.crm.amountDecimals": "{currency} では金額の小数点以下の桁数が多すぎます。",
  "error.crm.fieldPrivate": "このフィールドは非公開です。エージェントは読み取りも絞り込みもできません。",
  "error.crm.sourceOwned":
    "この行は Stripe が管理しています。Stripe で変更してください。変更は次の同期で CRM に反映されます。",
  "error.crm.sourceConnected": "Stripe はすでにこの CRM に接続されています。",
  "error.crm.sourceMissing": "この Stripe 接続はもう存在しません。",
  "error.crm.sourceSecretKey":
    "これはシークレットキーで、Stripe アカウントを変更できてしまいます。読み取りアクセスのみの制限付きキーを作成してください。",
  "error.crm.sourceInvalidKey": "Stripe がこのキーを受け付けません。制限付きキーをもう一度コピーしてください。",
  "error.crm.sourcePermission":
    "このキーでは顧客、請求書、サブスクリプション、イベント、商品を読み取れません。これらへの読み取りアクセスを付与してください。",
  "error.crm.sourceRateLimited": "Stripe へのリクエストが多すぎます。1 分後にもう一度お試しください。",
  "error.crm.sourceNetwork": "OpenBot は Stripe に接続できません。インターネット接続を確認してください。",
  "error.crm.sourceFailed":
    "Stripe が OpenBot で読み取れない応答を返しました。しばらくしてからもう一度お試しください。",
  "error.crm.sourceKeySaveFailed": "OpenBot はこのコンピューターに Stripe キーを保存できません。",
  "error.crm.off": "CRM はオフです。オーナーまたは管理者が「サーバー設定 > 試験運用」でオンにできます。",
  "error.crm.settingsSaveFailed": "OpenBot はこのサーバーで CRM の設定を保存できません。",
} as const satisfies PartialTranslation<typeof source>;
