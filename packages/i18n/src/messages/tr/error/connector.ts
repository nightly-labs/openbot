import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  // Yerleşik GitHub bağlantısı: cihaz akışı, belirteç yenileme ve saklanan dosya.
  "error.connector.githubUnavailable": "OpenBot'un bu derlemesinde GitHub Uygulaması yok.",
  "error.connector.githubDenied": "GitHub oturum açma isteği reddedildi.",
  "error.connector.githubCodeExpired": "GitHub kodunun süresi doldu. GitHub'a tekrar bağlanın.",
  "error.connector.githubDeviceFlowDisabled": "GitHub Uygulaması cihazla oturum açmaya izin vermiyor.",
  "error.connector.githubClientUnknown": "GitHub bu GitHub Uygulamasının İstemci Kimliğini (Client ID) bilmiyor.",
  "error.connector.githubUnexpected": "GitHub beklenmeyen bir yanıt gönderdi: {detail}",
  "error.connector.githubUnreachable": "OpenBot GitHub'a ulaşamıyor: {detail}",
  "error.connector.githubExpired": "GitHub bağlantısının süresi doldu. GitHub'a tekrar bağlanın.",
  "error.connector.githubFileUnreadable": "GitHub bağlantı dosyası okunamıyor.",
  "error.connector.githubFileTooLarge": "GitHub bağlantı dosyası çok büyük.",
  "error.connector.onePasswordCliMissing":
    "OpenBot 1Password CLI'yi bulamıyor. Yükleyin ve 1Password uygulamasında entegrasyonunu açın ya da bir hizmet hesabı belirteci kullanın.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot 1Password CLI'yi yükleyemedi. İnternet bağlantısını kontrol edin, ardından tekrar deneyin.",
  "error.connector.onePasswordCliSignedOut":
    "1Password CLI'de oturum açılmamış. 1Password uygulamasında entegrasyonunu açın, ardından yeniden bağlanın.",
  "error.connector.onePasswordCliFailed": "1Password CLI başarısız oldu: {detail}",
  "error.connector.onePasswordUnexpected": "1Password beklenmeyen bir yanıt gönderdi: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password hizmet hesabı belirtecini kabul etmedi.",
  "error.connector.onePasswordNoVault":
    "Hizmet hesabı bir kasayı okuyamıyor. Ona bir kasaya erişim verin, ardından tekrar deneyin.",
  "error.connector.onePasswordFileUnreadable": "1Password bağlantı dosyası okunamıyor.",
  "error.connector.onePasswordFileTooLarge": "1Password bağlantı dosyası çok büyük.",
  "error.connector.bitwardenFailed":
    "Bitwarden okunamadı. bw CLI'yi yükleyin, oturum açın, kilidini açın ve Shared with OpenBot adlı bir klasör oluşturun. Yeni bir oturum anahtarıyla bağlanın.",
  "error.connector.bitwardenHostInput":
    "Bir HTTPS sunucu adresi, API anahtarının client_id ve client_secret değerlerini ve ana parolayı girin.",
  "error.connector.bitwardenHostFailed":
    "Bu sunucuda Bitwarden açılamadı. Sunucu adresini, API anahtarını ve ana parolayı kontrol edin ve bir klasörün adının Shared with OpenBot olduğundan emin olun. Sonra tekrar bağlanın.",
  "error.connector.bitwardenCliInstallFailed":
    "Bu sunucuya Bitwarden CLI yüklenemedi. Ağ bağlantısını kontrol edin, sonra tekrar bağlanın.",
  "error.connector.bitwardenFileUnreadable": "Bitwarden bağlantı dosyası okunamıyor.",
} as const satisfies PartialTranslation<typeof source>;
