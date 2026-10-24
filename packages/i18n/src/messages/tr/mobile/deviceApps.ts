import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/deviceApps";

export const messages = {
  "mobile.deviceApps.title": "Bağlı uygulamalar",
  "mobile.deviceApps.apps": "Uygulamalar",
  "mobile.deviceApps.appsFooter":
    "Ajanlarının bu iPhone’daki uygulamaları kullanmasına izin ver. Bir uygulamayı açtığında iPhone onun iznini ister. Bir uygulama kapalıyken OpenBot, bir ajan onu ilk kez kullandığında sorar.",
  "mobile.deviceApps.writes": "Öğe ekleme",
  "mobile.deviceApps.writesFooter":
    "Her zaman’ı seçene kadar OpenBot, bir ajan etkinlik veya hatırlatıcı eklemeden önce sorar.",
  "mobile.deviceApps.app.calendar": "Takvim",
  "mobile.deviceApps.app.reminders": "Hatırlatıcılar",
  "mobile.deviceApps.app.contacts": "Kişiler",
  "mobile.deviceApps.app.location": "Konum",
  "mobile.deviceApps.app.denied": "{app} (reddedildi)",
  "mobile.deviceApps.write.calendar": "Etkinlikleri sormadan ekle",
  "mobile.deviceApps.write.reminders": "Hatırlatıcıları sormadan ekle",
  "mobile.deviceApps.osDenied": "{app} için iPhone Ayarları’nda izin ver",
  "mobile.deviceApps.consent.heading": "{app} için izin verilsin mi?",
  "mobile.deviceApps.consent.calendarListEvents": "Bir ajan Takvim’indeki etkinlikleri okumak istiyor.",
  "mobile.deviceApps.consent.calendarAddEvent": "Bir ajan bu etkinliği Takvim’ine eklemek istiyor: {title}",
  "mobile.deviceApps.consent.remindersList": "Bir ajan Hatırlatıcılar’ını okumak istiyor.",
  "mobile.deviceApps.consent.remindersAdd": "Bir ajan bu hatırlatıcıyı eklemek istiyor: {title}",
  "mobile.deviceApps.consent.contactsFind": "Bir ajan Kişiler’inde kişi aramak istiyor.",
  "mobile.deviceApps.consent.locationCurrent": "Bir ajan nerede olduğunu yaklaşık 100 metre doğrulukla bilmek istiyor.",
  "mobile.deviceApps.consent.privacy": "Ajanın okudukları onun bilgisayarına gider ve model sağlayıcısına ulaşabilir.",
  "mobile.deviceApps.consent.once": "Bir kez izin ver",
  "mobile.deviceApps.consent.always": "Her zaman izin ver",
  "mobile.deviceApps.consent.deny": "Reddet",
} as const satisfies PartialTranslation<typeof source>;
