import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  // Yerleşik GitHub bağlantısı: cihaz akışı, belirteç yenileme ve saklanan dosya.
  "error.connector.githubUnavailable": "OpenBot'un bu derlemesinde GitHub Uygulaması yok.",
  "error.connector.githubDenied": "GitHub girişi reddedildi.",
  "error.connector.githubCodeExpired": "GitHub kodunun süresi doldu. GitHub'a tekrar bağlanın.",
  "error.connector.githubDeviceFlowDisabled": "GitHub Uygulaması cihazla oturum açmaya izin vermiyor.",
  "error.connector.githubClientUnknown": "GitHub bu GitHub Uygulamasının İstemci Kimliğini (Client ID) bilmiyor.",
  "error.connector.githubUnexpected": "GitHub beklenmeyen bir yanıt gönderdi: {detail}",
  "error.connector.githubUnreachable": "OpenBot GitHub'a ulaşamıyor: {detail}",
  "error.connector.githubExpired": "GitHub bağlantısının süresi doldu. GitHub'a tekrar bağlanın.",
  "error.connector.githubFileUnreadable": "GitHub bağlantı dosyası okunamıyor.",
  "error.connector.githubFileTooLarge": "GitHub bağlantı dosyası çok büyük.",
} as const satisfies PartialTranslation<typeof source>;
