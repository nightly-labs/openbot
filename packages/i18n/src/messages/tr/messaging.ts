import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  // What the user can do about a Slack workspace connection that stopped.
  "messaging.help.invalid_token":
    "Slack artık bu çalışma alanında OpenBot'u kabul etmiyor. Kaldırılmış olabilir. Çalışma alanını tekrar bağlayın.",
  "messaging.help.secret_storage_unavailable":
    "OpenBot bu bilgisayardaki kayıtlı belirteçleri okuyamıyor. Çalışma alanı bağlantısını kesin, ardından tekrar bağlayın.",
  "messaging.help.relay_unavailable":
    "OpenBot bu bilgisayarda Slack etkinliklerini alamıyor. Oturum açın, Sunucu ayarlarından bu bilgisayara bir ad verin ve OpenBot'u açık tutun.",
  "messaging.help.not_linked": "Bu çalışma alanı bu sunucuya bağlı değil. Bağlamak için Yeniden bağlan'ı seçin.",
  // Bir Discord sunucusu bağlantısı için aynı yardım.
  "messaging.discordHelp.invalid_token":
    "Discord artık bu Discord sunucusunda OpenBot'u kabul etmiyor. Kaldırılmış olabilir. Discord sunucusunu tekrar bağlayın.",
  "messaging.discordHelp.secret_storage_unavailable":
    "OpenBot bu bilgisayardaki kayıtlı belirteçleri okuyamıyor. Discord sunucusu bağlantısını kesin, ardından tekrar bağlayın.",
  "messaging.discordHelp.relay_unavailable":
    "OpenBot bu bilgisayarda Discord etkinliklerini alamıyor. Oturum açın, Sunucu ayarlarından bu bilgisayara bir ad verin ve OpenBot'u açık tutun.",
  "messaging.discordHelp.not_linked":
    "Bu Discord sunucusu bu OpenBot sunucusuna bağlı değil. Bağlamak için Yeniden bağlan'ı seçin.",
} as const satisfies PartialTranslation<typeof source>;
