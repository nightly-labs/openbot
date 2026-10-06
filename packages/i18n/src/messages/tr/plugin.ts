import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  // Eklenti pazar yeri sayfası.
  "plugin.link.website": "Web sitesi",
  "plugin.link.privacyPolicy": "Gizlilik Politikası",
  "plugin.link.terms": "Hizmet Şartları",
  "plugin.copyLink": "Bağlantıyı kopyala",
  "plugin.askPrompt": "{name} eklentisine sor: {prompt}",
  "plugin.section.apps": "Uygulamalar",
  "plugin.section.skills": "Beceriler",
  "plugin.section.information": "Bilgiler",
  "plugin.info.developer": "Geliştirici",
  "plugin.info.category": "Kategori",
  "plugin.info.version": "Sürüm",

  // Kaldırma onayı. {number} burada çoğul formu olmayan bir sayıdır.
  "plugin.uninstallDialog.title": "{name} kaldırılsın mı?",
  "plugin.uninstallDialog.description":
    "Bu işlem, {name} tarafından bu bilgisayara yüklenenleri kaldırır. Bu ana makinede veya bu ajanda başka hiçbir şey değişmez.",
  "plugin.uninstallDialog.confirm": "Kaldır",
  "plugin.uninstallDialog.appsLabel": "Kaldırılacak uygulamalar, {number}",
  "plugin.uninstallDialog.appsTitle": "Bu ana makineden kaldırılan uygulamalar",
  "plugin.uninstallDialog.appsNote":
    "Araçları artık kullanılamaz ve OpenBot'un onlar için sakladığı oturum bilgileri unutulur.",
  "plugin.uninstallDialog.skillsLabel": "Kaldırılacak beceriler, {number}",
  "plugin.uninstallDialog.skillsTitle": "{agentName} ajanından kaldırılan beceriler",
} as const satisfies PartialTranslation<typeof source>;
