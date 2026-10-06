import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "İzin kurulumu macOS üzerinde kullanılabilir.",
  "status.remote.setupInstallHost": "Uzak masaüstü ana makine bileşenini yükleyin, ardından tekrar kontrol edin.",
  "status.remote.setupUpdateRuntime": "macOS izinlerini kontrol etmek için uzak masaüstü çalışma zamanını güncelleyin.",
  "status.remote.setupCheckFailed":
    "Sunshine izin kontrolünü tamamlayamadı. Ana makine oturumunu kontrol edin, ardından tekrar deneyin.",
  "status.remote.setupServiceFailed":
    "Uzak masaüstü hizmeti başlatılamadı. Bu macOS kullanıcısının etkin bir GUI oturumuna sahip olduğunu kontrol edin.",
  "status.remote.connectingSunshine": "Sunshine üzerinden bağlanılıyor…",
  "status.remote.switchingMonitor": "Paylaşılan monitör değiştiriliyor…",
  "status.remote.controlConnected": "Uzaktan kontrol bağlandı.",
  "status.remote.controlFailed": "Uzaktan kontrol başarısız oldu.",
  "status.remote.stagePreferences": "Yerel sohbet tercihleri yükleniyor: {reason}",
  "status.remote.stageConnection": "Masaüstüne bağlanılıyor: {reason}",
  "status.remote.stageCompatibility": "Masaüstü uyumluluğu kontrol ediliyor: {reason}",
  "status.remote.stageAgents": "Ajanlar yükleniyor: {reason}",
  "status.remote.stageReads": "Okuma durumu yükleniyor: {reason}",
  "status.remote.stageConversations": "Konuşmalar yükleniyor: {reason}",
  "status.remote.suspendedDetail": "Bağlanmadan önce OpenBot Mobile veya masaüstü uygulamasını güncelleyin.\n{detail}",
  "status.remote.cooldownDetail":
    "{limit} denemeden sonra bağlantı başarısız oldu. {minutes}:{seconds} içinde yeniden deneniyor.\n{detail}",
  "status.remote.cooldown":
    "{limit} denemeden sonra bağlantı başarısız oldu. {minutes}:{seconds} içinde yeniden deneniyor.",
  "status.remote.connectionLostDetail": {
    one: "Bağlantı kesildi. {count} sn içinde yeniden deneniyor.\n{detail}",
    other: "Bağlantı kesildi. {count} sn içinde yeniden deneniyor.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Bağlantı kesildi. {count} sn içinde yeniden deneniyor.",
    other: "Bağlantı kesildi. {count} sn içinde yeniden deneniyor.",
  },
  "status.remote.attemptFailedDetail": {
    one: "Bağlantı denemesi başarısız oldu. {count} sn içinde yeniden deneniyor.\n{detail}",
    other: "Bağlantı denemesi başarısız oldu. {count} sn içinde yeniden deneniyor.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "Bağlantı denemesi başarısız oldu. {count} sn içinde yeniden deneniyor.",
    other: "Bağlantı denemesi başarısız oldu. {count} sn içinde yeniden deneniyor.",
  },
  "status.remote.reconnectingDetail": {
    one: "Yeniden bağlanılıyor {attempt}/{count}\n{detail}",
    other: "Yeniden bağlanılıyor {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    one: "Yeniden bağlanılıyor {attempt}/{count}",
    other: "Yeniden bağlanılıyor {attempt}/{count}",
  },
} as const satisfies PartialTranslation<typeof source>;
