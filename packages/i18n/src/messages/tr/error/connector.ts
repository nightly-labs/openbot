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
  "error.connector.telegramAccountCredentialsMissing":
    "Telegram uygulamanızın api_id ve api_hash değerlerini girin. Bunları my.telegram.org adresinden alabilirsiniz.",
  "error.connector.telegramAccountCredentialsInvalid":
    "api_id bir sayıdır ve api_hash 0-9 ile a-f arasındaki 32 karakterden oluşur. Bunları my.telegram.org adresinden yeniden kopyalayın.",
  "error.connector.telegramAccountApiRejected":
    "Telegram bu api_id ve api_hash değerlerini kabul etmiyor. Bunları my.telegram.org adresinden yeniden kopyalayın.",
  "error.connector.telegramAccountPhoneFormat": "Telefon numarasını ülke koduyla girin, örneğin +48 600 100 200.",
  "error.connector.telegramAccountPhoneInvalid": "Telegram bu numarayı tanımıyor. Ülke kodunu ekleyin, örneğin +48.",
  "error.connector.telegramAccountCodeInvalid": "Bu kod doğru değil. Kontrol edip yeniden deneyin.",
  "error.connector.telegramAccountCodeEmpty": "Telegram'ın size gönderdiği kodu girin.",
  "error.connector.telegramAccountCodeExpired": "Kodun süresi doldu. Yeni bir kod almak için yeniden başlayın.",
  "error.connector.telegramAccountPasswordInvalid": "Bu parola doğru değil. Yeniden deneyin.",
  "error.connector.telegramAccountPasswordEmpty": "İki adımlı doğrulama parolanızı girin.",
  "error.connector.telegramAccountPasswordNeeded": "Telegram iki adımlı doğrulama parolanıza ihtiyaç duyuyor.",
  "error.connector.telegramAccountNoAccount":
    "Bu numaranın Telegram hesabı yok. Zaten Telegram kullanan bir numarayla giriş yapın.",
  "error.connector.telegramAccountPhoneBanned": "Telegram bu numarayı yasakladı.",
  "error.connector.telegramAccountQrExpired": "QR kodun süresi siz taramadan önce doldu. Yeniden başlayın.",
  "error.connector.telegramAccountFloodWait": "Telegram beklemenizi istiyor. {count} dk sonra yeniden deneyin.",
  "error.connector.telegramAccountCancelled": "Telegram girişi iptal edildi.",
  "error.connector.telegramAccountTimedOut": "Giriş, 10 dakika boyunca etkinlik olmadığı için durdu. Yeniden başlayın.",
  "error.connector.telegramAccountMovedOn": "Giriş başka bir adıma geçti. Yeniden başlayın.",
  "error.connector.telegramAccountRefused": "Telegram girişi reddetti: {detail}",
  "error.connector.telegramAccountSaveFailed": "OpenBot Telegram bağlantısını kaydedemedi: {detail}",
  "error.connector.telegramAccountSessionEnded":
    "Telegram bu oturumu sonlandırdı, örneğin Ayarlar > Cihazlar bölümünde. Telegram hesabınızı yeniden bağlayın.",
  "error.connector.telegramAccountFileUnreadable": "Telegram hesabı bağlantı dosyası okunamıyor.",
  "error.connector.telegramAccountFileTooLarge": "Telegram hesabı bağlantı dosyası çok büyük.",
  "error.connector.whatsappAccountPhoneFormat": "Telefon numarasını ülke koduyla girin, örneğin +48 600 100 200.",
  "error.connector.whatsappAccountPairingFailed": "WhatsApp bir kod vermedi: {detail}",
  "error.connector.whatsappAccountQrExpired": "Kodun süresi siz kullanmadan önce doldu. Yeniden başlayın.",
  "error.connector.whatsappAccountTimedOut":
    "Bağlama, 10 dakika boyunca etkinlik olmadığı için durdu. Yeniden başlayın.",
  "error.connector.whatsappAccountMovedOn": "Bağlama başka bir adıma geçti. Yeniden başlayın.",
  "error.connector.whatsappAccountLinkFailed": "WhatsApp bu cihazı bağlamadı: {detail}",
  "error.connector.whatsappAccountSaveFailed": "OpenBot WhatsApp bağlantısını kaydedemedi: {detail}",
  "error.connector.whatsappAccountLoggedOut":
    "WhatsApp bu cihazı kaldırdı, örneğin Ayarlar > Bağlı cihazlar bölümünde. WhatsApp hesabınızı yeniden bağlayın.",
  "error.connector.whatsappAccountReplaced":
    "Başka bir program bu bağlı cihazı açtı, bu yüzden WhatsApp buradaki bağlantıyı kapattı. Bağlantıyı kesin, sonra yeniden bağlayın.",
  "error.connector.whatsappAccountForbidden":
    "WhatsApp bu cihazı reddetti. Numaranız kısıtlanmış olabilir. Telefonunuzdaki WhatsApp'ı kontrol edin.",
  "error.connector.whatsappAccountOutdated":
    "WhatsApp bağlantının bu sürümünü artık kabul etmiyor. OpenBot'u güncelleyin, sonra yeniden bağlayın.",
  "error.connector.whatsappAccountOffline":
    "WhatsApp'a şu anda ulaşılamıyor. OpenBot yeniden deniyor. Ajanlar bu bilgisayardaki sohbetleri okumaya devam edebilir.",
  "error.connector.whatsappAccountFileUnreadable": "WhatsApp hesabı bağlantı dosyası okunamıyor.",
} as const satisfies PartialTranslation<typeof source>;
