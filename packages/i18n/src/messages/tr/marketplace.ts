import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/marketplace";

export const messages = {
  // The listing: categories, rows, and the words for each kind of listing.
  "marketplace.category.coding": "Kodlama",
  "marketplace.category.design": "Tasarım",
  "marketplace.category.dataAnalytics": "Veri ve Analitik",
  "marketplace.category.documents": "Belgeler",
  "marketplace.category.productivity": "Verimlilik",
  "marketplace.category.research": "Araştırma",
  "marketplace.category.automation": "Otomasyon",
  "marketplace.category.other": "Diğer",
  "marketplace.loadFailed": "Pazaryeri yüklenemedi.",
  "marketplace.loading.skills": "Beceriler yükleniyor",
  "marketplace.loading.agents": "Ajanlar yükleniyor",
  "marketplace.noMatch.skills": "Bu aramayla eşleşen beceri yok.",
  "marketplace.noMatch.agents": "Bu aramayla eşleşen ajan yok.",
  "marketplace.loadMore": "Daha fazla yükle",
  "marketplace.version": "Sürüm {version}",

  // The dialog frame: title, close and tabs.
  "marketplace.title": "Pazaryeri",
  "marketplace.close": "Pazaryerini kapat",
  "marketplace.kinds": "Pazaryeri içerik türleri",
  "marketplace.tab.agents": "Ajanlar",
  "marketplace.tab.skills": "Beceriler",

  // A plugin link.
  "marketplace.plugins.missing": "Bu eklenti OpenBot kataloğunda yok.",

  // The agent page.
  "marketplace.agents.loadingDetail": "Ajan ayrıntıları yükleniyor…",
  "marketplace.agents.skills": "Beceriler",
  "marketplace.agents.routines": "Rutinler",
  "marketplace.agents.routineActive": "Etkin",
  "marketplace.agents.routineInactive": "Devre dışı",

  // The skill page, and why Try is off.
  "marketplace.skill.loading": "Beceri yükleniyor",
  "marketplace.skill.update": "Beceriyi güncelle",
  "marketplace.try.readFailed": "OpenBot bu ajanın becerilerini okuyamadı. Tekrar deneyin.",
  "marketplace.try.enable": "Bu beceriyi denemek için ajan ayarlarından etkinleştirin.",
  "marketplace.try.repair": "Bu beceriyi denemek için ajan ayarlarından onarın.",
  "marketplace.try.update": "Bu sürümü denemek için bu beceriyi güncelleyin.",
  "marketplace.try.composerUnavailable": "Ajan mesaj kutusu kullanılamıyor.",

  // The Marketplace window. {name} is an agent, app or skill name. {count} is a number.
  "marketplace.open": "{name} öğesini aç",
  "marketplace.tab.apps": "Uygulamalar",
  "marketplace.crumbs.label": "Konum",
  "marketplace.search.label": "Pazaryerinde ara",
  "marketplace.search.placeholder": "Ara",
  "marketplace.installs": {
    one: "{installs} yükleme",
    other: "{installs} yükleme",
  },
  "marketplace.filter": "Filtre",
  "marketplace.filter.on": "Filtre: {filters}",
  "marketplace.filter.all": "Tümü",
  "marketplace.filter.status": "Durum",
  "marketplace.filter.category": "Kategori",
  "marketplace.filter.added": "Eklendi",
  "marketplace.filter.notAdded": "Eklenmedi",
  "marketplace.filter.installed": "Kuruldu",
  "marketplace.filter.notInstalled": "Kurulmadı",
  "marketplace.filter.clear": "Filtreleri temizle",
  "marketplace.noMatch.apps": "Bu aramayla eşleşen uygulama yok.",
  "marketplace.noMatch.filters": "Filtrelerle eşleşen öğe yok.",
  "marketplace.noMatch.showAgents": {
    one: "{count} ajanı göster",
    other: "{count} ajanı göster",
  },
  "marketplace.noMatch.showApps": {
    one: "{count} uygulamayı göster",
    other: "{count} uygulamayı göster",
  },
  "marketplace.noMatch.showSkills": {
    one: "{count} beceriyi göster",
    other: "{count} beceriyi göster",
  },
  "marketplace.empty.agents": "Pazaryerinde henüz ajan yok.",
  "marketplace.empty.apps": "Pazaryerinde henüz uygulama yok.",
  "marketplace.empty.skills": "Pazaryerinde henüz beceri yok.",
  "marketplace.properties.agent": "Bu ajan hakkında",
  "marketplace.properties.skill": "Bu beceri hakkında",
  "marketplace.properties.creator": "Geliştirici",
  "marketplace.properties.category": "Kategori",
  "marketplace.properties.version": "Sürüm",
  "marketplace.properties.updated": "Güncellendi",
  "marketplace.properties.installs": "Yüklemeler",

  // Agents.
  "marketplace.agent.add": "Ekle",
  "marketplace.agent.addNamed": "{name} ekle",
  "marketplace.agent.addAgent": "Ajan ekle",
  "marketplace.agent.added": "Eklendi",
  "marketplace.agent.updateAvailable": "Güncelleme mevcut",
  "marketplace.agent.update": "Güncelle",
  "marketplace.agent.openChat": "Sohbeti aç",

  // Apps.
  "marketplace.app.connect": "Bağlan",
  "marketplace.app.reconnect": "Yeniden Bağlan",
  "marketplace.app.connectNamed": "{name} uygulamasına bağlan",
  "marketplace.app.reconnectNamed": "{name} uygulamasına yeniden bağlan",
  "marketplace.app.connected": "Bağlandı",
  "marketplace.app.attention": "İlgilenilmesi gerekiyor",
  "marketplace.app.notConnected": "Bağlı değil",
  "marketplace.app.custom": "MCP sunucusu",
  "marketplace.app.githubTagline": "Depolar, sorunlar ve çekme istekleri",
  "marketplace.app.yourApps": "Uygulamalarınız",
  "marketplace.app.moreApps": "Daha fazla uygulama",
  "marketplace.app.server": "Sunucu",
  "marketplace.app.command": "Komut",
  "marketplace.app.address": "Adres",
  "marketplace.app.disconnect.title": "Bağlantıyı Kes",
  "marketplace.app.disconnect.description":
    "{name} uygulamasını ve becerilerini bu bilgisayardan kaldırın. Daha sonra tekrar bağlayabilirsiniz.",
  "marketplace.app.disconnect.action": "Bağlantıyı Kes",
  "marketplace.app.remove.title": "Sunucuyu kaldır",
  "marketplace.app.remove.description": "Ajanlarınız artık bu sunucuyu kullanamaz. Ayarları silinir.",
  "marketplace.app.remove.action": "Kaldır",
  "marketplace.app.remove.confirmTitle": "{name} kaldırılsın mı?",
  "marketplace.app.remove.keep": "Koru",

  // Skills. {label} is the install button text: an agent name, "All agents" or "2 agents".
  "marketplace.skill.installMenu.install": "Kur",
  "marketplace.skill.installMenu.installNamed": "{name} kur",
  "marketplace.skill.installMenu.allAgents": "Tüm ajanlar",
  "marketplace.skill.installMenu.agents": {
    one: "{count} ajan",
    other: "{count} ajan",
  },
  "marketplace.skill.installMenu.here": "Buradasınız",
  "marketplace.skill.installMenu.change": {
    one: "{label} üzerinde {name} var. Değiştir",
    other: "{label} üzerinde {name} var. Değiştir",
  },
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "{name} içinde dene",

  // Results that a screen reader hears. {agents} is a list of agent names.
  "marketplace.notice.agentAdded": "{name} eklendi.",
  "marketplace.notice.agentUpdated": "{name} güncellendi.",
  "marketplace.notice.appConnected": "{name} bağlandı.",
  "marketplace.notice.appDisconnected": "{name} bağlantısı kesildi.",
  "marketplace.notice.serverRemoved": "{name} kaldırıldı.",
  "marketplace.notice.skillInstalled": {
    one: "{name} {count} ajana kuruldu.",
    other: "{name} {count} ajana kuruldu.",
  },
  "marketplace.notice.skillRemoved": {
    one: "{name} {count} ajandan kaldırıldı.",
    other: "{name} {count} ajandan kaldırıldı.",
  },
  "marketplace.error.skillPartial": "{name} şu ajanlarda değiştirilemedi: {agents}. {reason}",

  // Errors. {reason} is an error message. {failures} is a list of error messages.
  "marketplace.error.openLink": "Bağlantı açılamadı.",
  "marketplace.error.copyLink": "Bağlantı kopyalanamadı.",
  "marketplace.error.connectNoServer": "Bu uygulamayı bağlamak için yerel bir sunucu seçin.",
  "marketplace.error.installNoServer": "Bir eklenti yüklemek için yerel bir sunucu seçin.",
  "marketplace.error.installNoAgent": "Bu eklentinin becerilerini yüklemek için bir ajan seçin.",
  "marketplace.error.installLocalOnHost":
    "{name} uygulamasını bu ajanları çalıştıran bilgisayara yükleyin: uygulaması sunucusunu o bilgisayarda çalıştırır.",
  "marketplace.error.installOnHost":
    "{name} uygulamasını bu ajanları çalıştıran bilgisayara yükleyin: uygulaması bir tarayıcı girişi gerektirir.",
  "marketplace.error.appInvalid": "{name} eklenemiyor: {reason}",
  "marketplace.error.uninstallNoServer": "Bir eklentiyi kaldırmak için yerel bir sunucu seçin.",
  "marketplace.error.uninstallPartial": "{name} uygulamasının bazı kısımları kaldırılamadı. {failures}",
  "marketplace.error.actionFailed": "Pazaryeri eylemi tamamlanamadı. Tekrar deneyin.",
  "marketplace.thisAgent": "bu ajan",
} as const satisfies PartialTranslation<typeof source>;
