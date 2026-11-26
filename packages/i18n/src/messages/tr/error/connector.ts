import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "OpenBot'un bu derlemesinde GitHub Uygulaması yok.",
  "error.connector.githubDenied": "GitHub oturum açma isteği reddedildi.",
  "error.connector.githubCodeExpired": "GitHub kodunun süresi doldu. GitHub'a tekrar bağlanın.",
  "error.connector.githubDeviceFlowDisabled": "GitHub Uygulaması cihazla oturum açmaya izin vermiyor.",
  "error.connector.githubClientUnknown": "GitHub bu GitHub Uygulamasının İstemci Kimliğini (Client ID) bilmiyor.",
  "error.connector.githubUnexpected": "GitHub beklenmeyen bir yanıt gönderdi: {detail}",
  "error.connector.githubUnreachable": "OpenBot GitHub'a ulaşamıyor: {detail}",
  "error.connector.githubOffline":
    "OpenBot GitHub'a ulaşamıyor. OpenBot'u çalıştıran bilgisayarın veya sunucunun internet bağlantısını ve DNS ayarlarını kontrol edin, sonra tekrar deneyin.",
  "error.connector.githubExpired": "GitHub bağlantısının süresi doldu. GitHub'a tekrar bağlanın.",
  "error.connector.githubFileUnreadable": "GitHub bağlantı dosyası okunamıyor.",
  "error.connector.githubFileTooLarge": "GitHub bağlantı dosyası çok büyük.",
  "error.connector.nearSignIn": "Kripto cüzdanı kullanmak için OpenBot'ta oturum açın.",
  "error.connector.nearServiceUnavailable": "Kripto cüzdan hizmeti kullanılamıyor. Daha sonra tekrar deneyin.",
  "error.connector.nearWalletNotFound": "Bu cüzdan bu OpenBot hesabına veya sunucusuna ait değil.",
  "error.connector.nearWalletLimit": "Bugün çok fazla yeni cüzdan oluşturuldu. Yarın tekrar deneyin.",
  "error.connector.nearProviderBusy": "NEAR Intents şu anda yanıt vermiyor. Birkaç dakika sonra tekrar deneyin.",
  "error.connector.nearNoWallet": "Kurulu bir kripto cüzdan yok. Sunucu ayarları > Vault > Kripto bölümünden kurun.",
  "error.connector.nearWalletExists": "Bir kripto cüzdan zaten kurulu.",
  "error.connector.nearFrozen":
    "Kripto cüzdandan ödemeler duraklatıldı. Sunucu ayarları > Vault > Kripto bölümünden sürdürün.",
  "error.connector.nearAgentNotAllowed":
    "Bu ajan kripto cüzdandan ödeme yapamaz. Sunucu ayarları > Vault > Kripto bölümünden açın.",
  "error.connector.nearGrantExpired":
    "OpenBot'un kripto cüzdan için ödeme izni yok. Sunucu ayarları > Vault > Kripto bölümünden yenileyin.",
  "error.connector.nearUnknownAsset": "Kripto cüzdanda {asset} varlığı yok.",
  "error.connector.nearAmountInvalid": "{amount}, geçerli bir {asset} miktarı değil.",
  "error.connector.nearRecipientInvalid": "{recipient}, bir NEAR hesabı veya chain:address değil.",
  "error.connector.nearRefused": "NEAR Intents Agent API isteği reddetti: {detail}",
  "error.connector.nearUnexpected": "NEAR Intents Agent API beklenmeyen bir yanıt gönderdi: {detail}",
  "error.connector.nearUnreachable": "OpenBot, NEAR Intents Agent API'ye ulaşamıyor: {detail}",
  "error.connector.nearFileUnreadable": "Kripto cüzdan dosyası okunamıyor.",
  "error.connector.nearFileTooLarge": "Kripto cüzdan dosyası çok büyük.",
  "error.connector.nearSigningCanceled": "İmza iptal edildi.",
  "error.connector.nearSigningExpired": "İmza zamanında gelmedi. Tekrar deneyin.",
  "error.connector.nearSigningInvalid": "Tarayıcıdan gelen imza geçerli değil.",
  "error.connector.nearSigningBusy": "Tarayıcıda başka bir imza bekliyor. Önce onu tamamlayın veya iptal edin.",
  "error.connector.nearPolicyCooldown": "Cüzdan kurallarını {time} itibarıyla yeniden değiştirebilirsiniz.",
  "error.connector.nearPolicyPending": "Politika değişikliği tamamlanmadı. Birkaç dakika sonra tekrar deneyin.",
  "error.connector.nearDeclined": "Sahip ödemeyi reddetti.",
  "error.connector.nearUncertain":
    "OpenBot ödemenin gönderilip gönderilmediğini bilmiyor. Tekrar ödeme yapmayın. Sahip, cüzdan geçmişini kontrol edebilir.",
  "error.connector.nearPaymentFailed": "Ödeme başarısız oldu: {detail}",
  "error.connector.nearPaymentUnknown": "Bu ödeme artık bir yanıt beklemiyor.",
  "error.connector.nearRuleFull": "Bir ödeme kuralında en fazla {limit} alıcı olabilir.",
  "error.connector.nearRulesFull": "Cüzdanda en fazla {limit} ödeme kuralı olabilir.",
  "error.connector.onePasswordCliMissing":
    "OpenBot 1Password CLI'yi bulamıyor. Yükleyin ve 1Password uygulamasında entegrasyonunu açın ya da bir hizmet hesabı belirteci kullanın.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot 1Password CLI'yi yükleyemedi. İnternet bağlantısını kontrol edin, ardından tekrar deneyin.",
  "error.connector.onePasswordCliSignedOut":
    "1Password CLI'de oturum açılmamış. 1Password uygulamasında entegrasyonunu açın, ardından yeniden bağlanın.",
  "error.connector.onePasswordAppUnreachable":
    "OpenBot, 1Password uygulamasına ulaşamıyor. 1Password'ü açın ve kilidini açın. Settings > Developer bölümünde “Integrate with 1Password CLI” seçeneğinin açık olduğundan emin olun. Ardından yeniden deneyin.",
  "error.connector.onePasswordCliFailed": "1Password CLI başarısız oldu: {detail}",
  "error.connector.onePasswordCliForbidden":
    "1Password hesabınız paylaşılan kasayı veya bir hizmet hesabı oluşturmanıza izin vermiyor. Hesabın sahibinden veya yöneticisinden bu izni isteyin ya da bir hizmet hesabı belirteci isteyip “Belirteç kullan” düğmesine tıklayın.",
  "error.connector.onePasswordUnexpected": "1Password beklenmeyen bir yanıt gönderdi: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password hizmet hesabı belirtecini kabul etmedi.",
  "error.connector.onePasswordUnreachable":
    "OpenBot 1Password'e bağlanamadı. İnternet bağlantısını kontrol edin, ardından tekrar deneyin.",
  "error.connector.onePasswordRateLimited":
    "1Password çok fazla istek aldı. Birkaç dakika bekleyin, ardından tekrar deneyin.",
  "error.connector.onePasswordNoVault":
    "Hizmet hesabı bir kasayı okuyamıyor. Ona bir kasaya erişim verin, ardından tekrar deneyin.",
  "error.connector.onePasswordReadFailed":
    "OpenBot, 1Password'deki girişlerinizi okuyamıyor. 1Password bağlantısını kesin, ardından yeniden bağlayın.",
  "error.connector.onePasswordFileUnreadable": "1Password bağlantı dosyası okunamıyor.",
  "error.connector.onePasswordFileTooLarge": "1Password bağlantı dosyası çok büyük.",
  "error.connector.bitwardenFailed":
    "Bitwarden okunamadı. bw CLI'yi yükleyin, oturum açın, kilidini açın ve Shared with OpenBot adlı bir klasör oluşturun. Yeni bir oturum anahtarıyla bağlanın.",
  "error.connector.bitwardenCliMissing":
    "OpenBot, Bitwarden CLI'yı bulamıyor. bw'yi kurun, yeni bir terminalde çalıştığından emin olun ve yeniden bağlanın.",
  "error.connector.bitwardenFolderMissing":
    "Bitwarden'da Shared with OpenBot adında tam olarak bir klasör olmalı. Klasörü oluşturun veya fazla olanı kaldırın, ardından yeniden bağlanın.",
  "error.connector.bitwardenHostInput":
    "Bir HTTPS sunucu adresi, API anahtarının client_id ve client_secret değerlerini ve ana parolayı girin.",
  "error.connector.bitwardenHostFailed":
    "Bu sunucuda Bitwarden açılamadı. Sunucu adresini, API anahtarını ve ana parolayı kontrol edin ve bir klasörün adının Shared with OpenBot olduğundan emin olun. Sonra tekrar bağlanın.",
  "error.connector.bitwardenHostSignInFailed":
    "Bu sunucuda Bitwarden'da oturum açılamadı. Sunucu adresini ve API anahtarını kontrol edin, sonra tekrar bağlanın.",
  "error.connector.bitwardenHostUnlockFailed":
    "Bu sunucuda Bitwarden kilidi açılamadı. Ana parolayı kontrol edin, sonra tekrar bağlanın.",
  "error.connector.bitwardenCliInstallFailed":
    "Bu sunucuya Bitwarden CLI yüklenemedi. Ağ bağlantısını kontrol edin, sonra tekrar bağlanın.",
  "error.connector.bitwardenFileUnreadable": "Bitwarden bağlantı dosyası okunamıyor.",
  "error.connector.passwordManagerUnknown": "OpenBot bu parola yöneticisini tanımıyor.",
  "error.connector.passwordManagerMethod": "Bu parola yöneticisi bu yolla bağlanamaz.",
  "error.connector.passwordManagerNoSignIn": "Açık bir oturum açma sayfası yok. Yeniden bağlanın.",
  "error.connector.protonPassFailed": "Proton Pass bağlanamadı. Yeniden bağlanın.",
  "error.connector.protonPassCliInstallFailed":
    "Proton Pass CLI yüklenemedi. Ağ bağlantısını kontrol edin, ardından yeniden bağlanın.",
  "error.connector.protonPassPlan":
    "Proton planınız Proton Pass CLI kullanımına izin vermiyor. Planı değiştirin, ardından yeniden bağlanın.",
  "error.connector.protonPassPlanMissing":
    "Proton planınız Proton Pass CLI'yi içermiyor. Pass Plus içeren bir Proton planı gerekir. Planı değiştirin, ardından yeniden bağlanın.",
  "error.connector.protonPassExpired": "Proton Pass erişimi sona erdi. Yeniden bağlanın.",
  "error.connector.protonPassKeyInvalid": "pst_ ile başlayan bir Proton Pass erişim anahtarı girin.",
  "error.connector.protonPassExtraPassword": "Ek parola doğru değil. Yeniden girin.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass ek parola istemedi.",
  "error.connector.protonPassFileUnreadable": "Proton Pass bağlantı dosyası okunamıyor.",
  "error.connector.protonPassSignInTimeout": "Proton oturum açma işlemi çok uzun sürdü. Yeniden bağlanın.",
  "error.connector.protonPassSetupFailed":
    "Proton Pass'te Shared with OpenBot kasası veya erişim anahtarı oluşturulamadı. Yeniden bağlanın.",
} as const satisfies PartialTranslation<typeof source>;
