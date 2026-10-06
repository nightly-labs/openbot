import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.status.notConnected": "Bağlı değil",
  "mobile.workspace.status.online": "Çevrim içi",
  "mobile.workspace.status.offline": "Çevrim dışı",
  "mobile.workspace.status.error": "Bağlantı hatası",
  "mobile.workspace.status.reconnecting": "Yeniden bağlanıyor",
  "mobile.workspace.status.attempt": "Deneme {attempt}/{limit}",
  "mobile.workspace.status.attemptPrefix": "Deneme ",
  "mobile.workspace.status.retryIn": "{seconds} saniye içinde tekrar dene",
  "mobile.workspace.section.agents": "Ajanlar",
  "mobile.workspace.error.directoryUnavailable": "Sunucu dizini kullanılamıyor.",
  "mobile.workspace.error.sectionsLoadFailed": "Bölümler yüklenemedi. Tekrar deneyin.",
  "mobile.workspace.error.transportNotReady": "Mobil aktarım hazır değil.",
  "mobile.workspace.error.sectionsUnsupported": "Bu ana makine bölüm değişikliklerini desteklemiyor.",
  "mobile.workspace.error.leaveOwnServer": "Yalnızca katılınan uzak sunuculardan ayrılınabilir.",
  "mobile.workspace.error.agentNotOnHost": "Ajan bu ana makinede değil.",
  "mobile.workspace.error.filesUnsupported":
    "Bu ana makine dosya yönetimini desteklemiyor. Ana makinedeki OpenBot'u güncelleyin.",
  "mobile.workspace.error.agentUnavailableOnHost": "Ajan bu ana makinede kullanılamıyor.",
  "mobile.workspace.error.agentUnavailable": "Ajan kullanılamıyor.",
  "mobile.workspace.error.formUnavailable": "Bu form artık kullanılamıyor.",
  "mobile.workspace.alert.preferencesTitle": "Sohbet tercihleri kaydedilemedi",
  "mobile.workspace.alert.preferencesBody": "Önceki tercihleriniz korundu. Lütfen tekrar deneyin.",
  "mobile.workspace.alert.updateRequiredTitle": "Güncelleme gerekli",
  "mobile.workspace.alert.updateRequiredUnread":
    "Konuşmaları okunmadı olarak işaretlemek için bu masaüstü sunucusunu güncelleyin.",
  "mobile.workspace.alert.markUnreadTitle": "Okunmadı olarak işaretlenemedi",
  "mobile.workspace.alert.markUnreadBody": "Sunucuya yeniden bağlanıp tekrar deneyin.",
  "mobile.workspace.alert.serverOrderTitle": "Sunucu sırası kaydedilemedi",
  "mobile.workspace.alert.serverOrderBody": "Önceki sıranız korundu. Lütfen tekrar deneyin.",
  "mobile.workspace.error.connectFailed": "Sunucu bağlantısı başarısız oldu.",
  "mobile.workspace.error.disconnectFailed": "Sunucu bağlantısı temiz bir şekilde kesilemedi.",
  "mobile.workspace.error.queueEditRejected": "Ana makine bu düzenlemeyi kabul etmedi.",
} as const satisfies PartialTranslation<typeof source>;
