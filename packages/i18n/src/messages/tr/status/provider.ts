import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "İndirme durduruldu. Tekrar deneyin.",
  "status.provider.downloadFailed": "İndirme başarısız oldu. Tekrar deneyin.",
  "status.provider.updateWaiting": "Güncelleme, geçerli tur bitince başlar.",
  "status.provider.confirmContinue": "Devam et",
  "status.provider.confirmCancel": "İptal",
  "status.provider.retryUnreachable": "{provider} sunucusuna bağlanamıyor. Yeniden deneme {attempt}/{maxAttempts}.",
  "status.provider.retryServerError":
    "{provider} sunucusu meşgul veya bir hata verdi. Yeniden deneme {attempt}/{maxAttempts}.",
  "status.provider.retryRecovered": "{provider} sunucusundan yeniden yanıt alıyor.",
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude standart hızda yanıt verdi. Claude aboneliğinde hızlı mod kullanım kredisi harcar. Bunu Claude hesabınızda açın.",
  "status.provider.claudeFastModeNotOnPlan": "Claude standart hızda yanıt verdi. Claude planınız hızlı modu içermiyor.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude standart hızda yanıt verdi. Hızlı mod yalnızca bir Anthropic API anahtarı veya Claude aboneliğiyle çalışır; Bedrock, Vertex, Foundry veya bir ağ geçidiyle çalışmaz.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude standart hızda yanıt verdi. Bu model hesabınızda hızlı modu kullanamaz.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude standart hızda yanıt verdi. Hızlı mod, Claude Code ayarlarında veya kuruluşunuz tarafından kapatılmış.",
  "status.provider.claudeFastModeUnavailable":
    "Claude standart hızda yanıt verdi. Claude Code bu turda hızlı modu kullanamadı.",
} as const satisfies PartialTranslation<typeof source>;
