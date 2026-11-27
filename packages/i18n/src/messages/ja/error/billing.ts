import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed":
    "サーバーのプランを変更できませんでした。「お支払い」を更新して、もう一度お試しください。",
  "error.billing.confirmMismatch": "削除するにはサーバー名を入力してください。",
  "error.billing.restartBusy": "サーバーは今は再起動できません。1 分後にもう一度お試しください。",
  "error.billing.restartUnavailable": "このサーバーはここから再起動できません。サポートにお問い合わせください。",
  "error.billing.planRequired": "このサーバーのプランは終了しました。サーバーを起動するにはプランを更新してください。",
  "error.billing.planSoldOut": "このプランは売り切れです。別のプランを選んでください。",
  "error.billing.storageUnavailable": "このストレージはこのサーバーでは利用できません。",
  "error.billing.storagePaymentFailed":
    "ストレージの支払いに失敗しました。支払い方法を更新して、もう一度お試しください。",
  "error.billing.licenseExists": "このアカウントにはすでにライセンスがあります。代わりにユーザー数を変更してください。",
  "error.billing.licenseCurrency": "ライセンスは他のプランと同じ通貨を使う必要があります。",
  "error.billing.planCurrency": "新しいプランは他のプランと同じ通貨を使う必要があります。",
  "error.billing.licenseUsersInUse": "ライセンスのユーザー数を、現在使っている人数より少なくすることはできません。",
  "error.billing.licensePaymentFailed":
    "追加ユーザーの支払いに失敗しました。支払い方法を更新して、もう一度お試しください。",
  "error.billing.licenseUnavailable": "現在ライセンスは利用できません。",
  "error.billing.mediaContentRefused":
    "モデルの安全チェックがプロンプトまたは画像を拒否しました。実在の人物、有名なキャラクター、ブランド、暴力、成人向けの内容はよく拒否されます。内容を変更して、もう一度お試しください。クレジットは使用されていません。",
  "error.billing.licenseOneUser": "このライセンスは 1 ユーザー分です。ユーザーを追加するには Team に変更してください。",
  "error.billing.licensePlanChange":
    "このライセンスはそのプランに変更できません。解約してから新しいプランを購入してください。",
  "error.billing.noLicense": "このアカウントにはライセンスがありません。",
  "error.billing.countryRequired":
    "お支払いの前に請求先の国を入力してください。OpenBot を更新してから、もう一度お試しください。",
  "error.billing.detailsInvalid": "国と VAT ID を確認してください。VAT ID は選択した国のものである必要があります。",
  "error.billing.vatIdInvalid":
    "EU の VAT システムにこの VAT ID がありません。番号を確認するか、VAT ID なしで続行してください。",
  "error.billing.vatUnavailable": "現在お支払いはご利用いただけません。後でもう一度お試しください。",
  "error.billing.invalidRequest": "お支払いのリクエストが無効です。",
  "error.billing.invalidResponse": "お支払いの応答が無効です。",
  "error.billing.notStripePage": "お支払いページが Stripe のページではありません。",
  "error.billing.customServerOfferMissing": "このサーバーには支払うプランがありません。",
  "error.billing.checkoutUnavailable": "今は支払いを開始できません。1 分後にもう一度お試しください。",
} as const satisfies PartialTranslation<typeof source>;
