import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot bağlanamadı. Tekrar deneyin.",
  "mobile.link.invite.signInTitle": "Bu sunucuya katılmak için giriş yapın",
  "mobile.link.invite.signInDescription":
    "Bilgisayarınızdaki OpenBot'ta QR kodunu tarayın. Ardından daveti inceleyebilirsiniz.",
  "mobile.link.invite.cancel": "Daveti iptal et",
  "mobile.link.pairing.title": "Bu telefonu bağlayın",
  "mobile.link.pairing.alreadySignedIn":
    "Zaten giriş yapmış durumdasınız. Başka bir hesap bağlamadan önce Ayarlar'dan çıkış yapın.",
  "mobile.link.pairing.description": "Yalnızca bu Mobile Connect bağlantısını masaüstünüzden istediyseniz devam edin.",
  "mobile.link.pairing.connect": "Bağlan",
  "mobile.link.plugin.title": "Eklenti sayfasını aç",
  "mobile.link.plugin.description": "Bu eklentiyi OpenBot web sitesinde görüntüleyin.",
  "mobile.link.plugin.openFailed": "Eklenti sayfası açılamadı.",
  "mobile.link.plugin.view": "Eklentiyi görüntüle",
  "mobile.link.unavailable.title": "Bağlantı kullanılamıyor",
  "mobile.link.unavailable.description": "Bu bağlantı geçersiz, artık kullanılamıyor veya mobilde desteklenmiyor.",
  "mobile.link.template.signInTitle": "Bu ajanı eklemek için giriş yapın",
  "mobile.link.template.signInDescription":
    "Bilgisayarınızdaki OpenBot'ta QR kodunu tarayın. Ardından ajanı eklemeden önce inceleyebilirsiniz.",
  "mobile.link.template.loading": "Ajan yükleniyor…",
  "mobile.link.template.creator": "{name} tarafından",
  "mobile.link.template.section.instructions": "Talimatlar",
  "mobile.link.template.section.skills": "Beceriler",
  "mobile.link.template.section.noSkills": "Beceri yok.",
  "mobile.link.template.section.routines": "Rutinler",
  "mobile.link.template.section.noRoutines": "Rutin yok.",
  "mobile.link.template.skill.local": "Yerel beceri (yalnızca SKILL.md)",
  "mobile.link.template.skill.marketplace": "Pazar yeri becerisi, sürüm {version}",
  "mobile.link.template.server.title": "Sunucuya ekle",
  "mobile.link.template.server.footer": "Yalnızca sahip veya yönetici olduğunuz sunucular listelenir.",
  "mobile.link.template.server.updateRequired": "Paylaşılan ajanları eklemek için bu sunucudaki OpenBot'u güncelleyin.",
  "mobile.link.template.server.none":
    "Paylaşılan bir ajan eklemek için bir sunucunun sahibi veya yöneticisi olmalısınız.",
  "mobile.link.template.install.action": "Ajan ekle",
  "mobile.link.template.install.pending": "Ekleniyor…",
  "mobile.link.template.install.failed": "Ajan eklenemedi.",
  "mobile.link.template.notFound.title": "Ajan bulunamadı",
  "mobile.link.template.notFound.description": "Bu paylaşılan ajan mevcut değil veya oluşturan kişi yayından kaldırdı.",
  "mobile.link.template.error.title": "Ajan yüklenemedi",
  "mobile.link.template.error.loadFailed": "Paylaşılan ajan okunamadı. Tekrar deneyin.",
  "mobile.link.template.error.unsupported":
    "Bu sunucu paylaşılan ajanları ekleyemiyor. Sunucuyu çalıştıran bilgisayardaki OpenBot'u güncelleyin.",
} as const satisfies PartialTranslation<typeof source>;
