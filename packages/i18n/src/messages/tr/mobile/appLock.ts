import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/appLock";

export const messages = {
  "mobile.appLock.title": "Uygulama kilidi",
  "mobile.appLock.method.pin": "PIN kodu",
  "mobile.appLock.method.faceId": "Face ID",
  "mobile.appLock.method.touchId": "Touch ID",
  "mobile.appLock.method.phone": "Telefon kilidi",
  "mobile.appLock.methods.title": "Kilit açma yöntemi",
  "mobile.appLock.methods.footer":
    "PIN'i, {method} yöntemini veya ikisini birden açın. OpenBot, ayrıldığınızda kilitlenir ve döndüğünüzde bunlardan birini ister.",
  "mobile.appLock.methods.footerPinOnly": "PIN'i açın. OpenBot, ayrıldığınızda kilitlenir ve döndüğünüzde PIN'i ister.",
  "mobile.appLock.changePin": "PIN'i değiştir",
  "mobile.appLock.lockAfter.title": "OpenBot'u kilitle",
  "mobile.appLock.lockAfter.immediately": "Hemen",
  "mobile.appLock.lockAfter.minutes": { one: "{count} dakika sonra", other: "{count} dakika sonra" },
  "mobile.appLock.lockAfter.hours": { one: "{count} saat sonra", other: "{count} saat sonra" },
  "mobile.appLock.lockWithPhone": "Telefon kilitlendiğinde",
  "mobile.appLock.lockAfter.footer":
    "Süre, OpenBot'tan ayrıldığınızda başlar. OpenBot yeniden başladığında her zaman kilitlenir.",
  "mobile.appLock.device.turnOnPrompt": "OpenBot için {method} yöntemini açın",
  "mobile.appLock.device.failed": "{method} doğrulamadı. Tekrar deneyin.",
  "mobile.appLock.device.unavailable": "Önce telefonunuzda bir parola belirleyin.",
  "mobile.appLock.pinSetup.title": "PIN kodu",
  "mobile.appLock.pinSetup.enter": "4 haneli yeni bir PIN girin",
  "mobile.appLock.pinSetup.confirm": "PIN'i tekrar girin",
  "mobile.appLock.pinSetup.mismatch": "PIN'ler aynı değil. Tekrar deneyin.",
  "mobile.appLock.pinSetup.saveFailed": "PIN kaydedilemedi. Tekrar deneyin.",
  "mobile.appLock.lock.title": "OpenBot kilitli",
  "mobile.appLock.lock.confirmTitle": "Kimliğinizi doğrulayın",
  "mobile.appLock.lock.enterPin": "PIN'inizi girin",
  "mobile.appLock.lock.unlockPrompt": "OpenBot'un kilidini açın",
  "mobile.appLock.lock.useDevice": "{method} kullan",
  "mobile.appLock.lock.unlock": "Kilidi aç",
  "mobile.appLock.lock.wrongPin": "Yanlış PIN.",
  "mobile.appLock.lock.attemptsLeft": {
    one: "Yanlış PIN. Oturum kapanmadan önce {count} deneme hakkınız kaldı.",
    other: "Yanlış PIN. Oturum kapanmadan önce {count} deneme hakkınız kaldı.",
  },
  "mobile.appLock.lock.waitSeconds": {
    one: "Çok fazla deneme. {count} saniye sonra tekrar deneyin.",
    other: "Çok fazla deneme. {count} saniye sonra tekrar deneyin.",
  },
  "mobile.appLock.lock.waitMinutes": {
    one: "Çok fazla deneme. {count} dakika sonra tekrar deneyin.",
    other: "Çok fazla deneme. {count} dakika sonra tekrar deneyin.",
  },
  "mobile.appLock.lock.checkFailed": "PIN kontrol edilemedi. Tekrar deneyin.",
  "mobile.appLock.lock.pinMissing":
    "Bu telefonda OpenBot için PIN yok. Uygulama kilidini sıfırlamak için oturumu kapatın.",
  "mobile.appLock.lock.loadFailed": "Uygulama kilidi ayarları okunamadı.",
  "mobile.appLock.lock.retry": "Tekrar dene",
  "mobile.appLock.lock.forgotPin": "PIN'i mi unuttunuz?",
  "mobile.appLock.lock.signOut": "Oturumu kapat",
  "mobile.appLock.lock.signOutTitle": "OpenBot oturumu kapatılsın mı?",
  "mobile.appLock.lock.signOutBody":
    "Bu işlem uygulama kilidini kaldırır ve bu telefondaki oturumunuzu kapatır. Masaüstünüzdeki OpenBot'tan yeni bir kod tarayarak yeniden bağlanın.",
  "mobile.appLock.lock.signedOut": "Çok fazla yanlış PIN girildi. OpenBot bu telefondaki oturumunuzu kapattı.",
  "mobile.appLock.lock.delete": "Rakamı sil",
  "mobile.appLock.lock.progress": {
    one: "4 rakamdan {count} tanesi girildi",
    other: "4 rakamdan {count} tanesi girildi",
  },
} as const satisfies PartialTranslation<typeof source>;
