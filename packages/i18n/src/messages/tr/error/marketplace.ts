import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  // Agent marketplace and agent link errors.
  "error.marketplace.timezoneInvalid": "Yerel saat dilimi geçersiz.",
  "error.marketplace.installedAgentMissing": "Kurulu ajan artık mevcut değil.",
  "error.marketplace.differentListing": "Bu yerel ajan farklı bir pazaryeri ajanından kuruldu.",
  "error.marketplace.marketplaceAvatarInvalid": "Pazaryeri ajanı avatarı geçersiz.",
  "error.marketplace.shareCardInvalid": "Paylaşım kartı geçersiz.",
  "error.marketplace.cannotPublish": "Bu ajan yayımlanamaz.",
  "error.marketplace.templateName": {
    one: "Bu ajana 1 ila {count} karakterden oluşan bir ad verin.",
    other: "Bu ajana 1 ila {count} karakterden oluşan bir ad verin.",
  },
  "error.marketplace.templateRole": {
    one: "Rol {count} karakterden daha uzun. Kısaltın.",
    other: "Rol {count} karakterden daha uzun. Kısaltın.",
  },
  "error.marketplace.templateNoInstructions": "Yayımlamadan önce bu ajana talimatlar ekleyin.",
  "error.marketplace.templateInstructions": {
    one: "Talimatlar {count} karakterden daha uzun. Kısaltın.",
    other: "Talimatlar {count} karakterden daha uzun. Kısaltın.",
  },
  "error.marketplace.templateAvatar": "Bu ajanın avatarı geçerli değil. Ajan ayarlarından tekrar seçin.",
  "error.marketplace.templateSkills": {
    one: "Bir ajan en fazla {count} beceri yayımlayabilir. Bazılarını kaldırın.",
    other: "Bir ajan en fazla {count} beceri yayımlayabilir. Bazılarını kaldırın.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "Bir ajan en fazla {count} yerel beceri yayımlayabilir. Bazılarını kaldırın.",
    other: "Bir ajan en fazla {count} yerel beceri yayımlayabilir. Bazılarını kaldırın.",
  },
  "error.marketplace.templateSkill": '"{name}" becerisi yayımlanamaz. Adını ve SKILL.md dosyasını denetleyin.',
  "error.marketplace.templateRoutines": {
    one: "Bir ajan en fazla {count} rutin yayımlayabilir. Bazılarını kaldırın.",
    other: "Bir ajan en fazla {count} rutin yayımlayabilir. Bazılarını kaldırın.",
  },
  "error.marketplace.templateRoutine": {
    one: '"{name}" rutini en fazla {count} karakterden oluşan bir ada ve bir talimata ihtiyaç duyar.',
    other: '"{name}" rutini en fazla {count} karakterden oluşan bir ada ve bir talimata ihtiyaç duyar.',
  },
  // Fills `{name}` above when the routine has no name.
  "error.marketplace.templateRoutineNoName": "adsız",
  "error.marketplace.templateTooLarge":
    "Bu ajan yayımlanamayacak kadar büyük. Talimatlarını, becerilerini veya rutinlerini kısaltın.",
  "error.marketplace.linkInvalid": "Ajan bağlantısı geçersiz.",
  "error.marketplace.changedSinceOpened":
    "Bu ajan siz açtıktan sonra değişti. Yeni sürümü incelemek için bağlantıyı tekrar açın.",
  "error.marketplace.avatarInvalid": "Ajan avatarı geçersiz.",
  "error.marketplace.secretInName": "Yayımlamadan önce addaki gizli anahtarı veya e-posta adresini kaldırın.",
  "error.marketplace.secretInTitle": "Yayımlamadan önce başlıktaki gizli anahtarı veya e-posta adresini kaldırın.",
  "error.marketplace.secretInInstructions":
    "Yayımlamadan önce talimatlardaki gizli anahtarı veya e-posta adresini kaldırın.",
  "error.marketplace.secretInRoutine":
    'Yayımlamadan önce "{name}" rutinindeki gizli anahtarı veya e-posta adresini kaldırın.',
  "error.marketplace.secretInSkill":
    'Yayımlamadan önce "{name}" becerisindeki gizli anahtarı veya e-posta adresini kaldırın.',
  "error.marketplace.catalogLoadFailed": "Pazaryeri yüklenemedi. Tekrar deneyin.",
  "error.marketplace.templateUnreadable": "Bu paylaşılan ajan okunamadı. Sahibi kaldırmış olabilir.",
} as const satisfies PartialTranslation<typeof source>;
