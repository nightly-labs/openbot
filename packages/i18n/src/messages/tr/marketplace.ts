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
  "marketplace.app.onePasswordTagline": "Paylaştığınız oturum bilgileriyle sitelerde oturum açın",
  // The category row in the 1Password page's information.
  "marketplace.app.onePasswordCategory": "Oturum Açma ve Kimlik Bilgisi Yönetimi",
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

  // The catalog apps' listing text, by slug. Each English text is the catalog's own text, byte for
  // byte: a key whose English no longer matches the catalog is not used. The prompts are requests that
  // the user sends to an agent.
  "marketplace.plugin.aave.tagline": "Aave verileri ve işlemleri",
  "marketplace.plugin.aave.description":
    "Aave, kullanıcıların canlı Aave V3 ve V4 piyasalarını keşfetmesine, cüzdan pozisyonlarını ve DAO yönetişimini incelemesine, borç verme işlemlerini simüle etmesine ve emanetsiz işlemler hazırlamasına yardımcı olur. Her işlem imzasız olarak döndürülür: eklenti piyasaları okur ve çağrıyı yazar, cüzdan ise kullanıcıda kalır.",
  "marketplace.plugin.aave.app":
    "Canlı V3 ve V4 piyasaları, cüzdan pozisyonları, DAO yönetişimi ve hazırlanmış işlemler, tek bir MCP sunucusu üzerinden.",
  "marketplace.plugin.aave.prompt.stablecoinYield":
    "Şu anda Aave genelinde stablecoin'lerden en fazla nerede kazanabilirim?",
  "marketplace.plugin.aave.prompt.usdcRates":
    "Şu anda USDC için hangisi daha fazla ödüyor: Ethereum'da Aave V3 mü, V4 mü?",
  "marketplace.plugin.aave.prompt.healthFactor":
    "0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c adresinin sağlık faktörü nedir ve tasfiyeye ne kadar uzak?",
  "marketplace.plugin.canva.tagline": "Tasarımlar, varlıklar ve dışa aktarmalar",
  "marketplace.plugin.canva.description":
    "Canva, kullanıcıların sözcüklerle tasarım oluşturup düzenlemesine, kendi tasarım kitaplıklarında arama yapmasına, varlık yükleyip düzenlemesine, bir kanalın gerektirdiği biçimde dışa aktarmasına ve işin olduğu yere yorum bırakmasına olanak tanır. Her kullanıcı kendi Canva hesabında oturum açar ve ajan o hesabın yapabildiği her şeyi yapabilir.",
  "marketplace.plugin.canva.app":
    "Tasarım oluşturma ve düzenleme, kitaplık araması, varlık ve marka yönetimi, dışa aktarmalar ve yorumlar, tek bir MCP sunucusu üzerinden.",
  "marketplace.plugin.canva.prompt.recentDesign": "En son düzenlediğim Canva tasarımını göster.",
  "marketplace.plugin.canva.prompt.socialResize":
    "Lansman posterimi Instagram için yeniden boyutlandır ve ikisini de PNG olarak dışa aktar.",
  "marketplace.plugin.canva.prompt.deckFromNotes": "Bu sürüm notlarını altı slaytlık bir Canva sunumuna dönüştür.",
  "marketplace.plugin.linear.tagline": "Sorunlar ve proje önceliklendirme",
  "marketplace.plugin.linear.description":
    "Linear, ajanların oturum açmış hesabın ait olduğu çalışma alanında atanmış sorunları listelemesine, iş listesini önceliklendirmesine, durumları güncellemesine ve yeni sorun taslakları hazırlamasına olanak tanır. Her kullanıcı tarayıcı üzerinden kendi Linear hesabında oturum açar.",
  "marketplace.plugin.linear.app":
    "Sorun arama, önceliklendirme, durum güncellemeleri ve sorun oluşturma, tarayıcıda oturum açmayla Linear'ın MCP sunucusu üzerinden.",
  "marketplace.plugin.linear.prompt.myWeek": "Bu hafta bana ne atandı?",
  "marketplace.plugin.linear.prompt.backlog":
    "İş listesini önceliklendir: ne eskidi, ne engellendi veya neyin sahibi yok?",
  "marketplace.plugin.linear.prompt.newIssue":
    "Eşitleme kuyruğundaki çökme için yeniden oluşturma adımlarıyla bir sorun kaydı aç.",
  "marketplace.plugin.notion.tagline": "Belgeler ve bilgi bankası",
  "marketplace.plugin.notion.description":
    "Notion, ajanların sayfaları okuyup yazmasına, çalışma alanında arama yapmasına ve toplantı notlarını ve şartnameleri ekibin zaten çalıştığı yerde tutmasına olanak tanır. Her kullanıcı tarayıcı üzerinden kendi Notion hesabında oturum açar.",
  "marketplace.plugin.notion.app":
    "Sayfa arama, okuma, yazma ve çalışma alanında gezinme, tarayıcıda oturum açmayla Notion'ın MCP sunucusu üzerinden.",
  "marketplace.plugin.notion.prompt.findSpec": "Güncel lansman şartnamesini bul ve açık soruları özetle.",
  "marketplace.plugin.notion.prompt.meetingNotes":
    "Bu maddeleri ekip alanımda yapılandırılmış bir toplantı notuna dönüştür.",
  "marketplace.plugin.notion.prompt.updateDoc": "Katılım belgesini yeni sürüm kontrol listesiyle güncelle.",
  "marketplace.plugin.figma.tagline": "Tasarımlar ve prototipler",
  "marketplace.plugin.figma.description":
    "Figma, ajanların tasarım dosyalarını okumasına, bileşenleri, stilleri ve değişkenleri incelemesine ve üretim şartnamelerini mühendislere teslim etmesine olanak tanır. Bu bilgisayardaki Figma masaüstü uygulamasındaki MCP sunucusuna bağlanır. Sunucu yalnızca tasarımları okuyabilir; yazma desteği üzerinde çalışılıyor.",
  "marketplace.plugin.figma.app":
    "Tasarım bağlamı, meta veriler, değişkenler ve ekran görüntüleri, Figma masaüstü uygulamasındaki MCP sunucusu üzerinden. Şimdilik salt okunur.",
  "marketplace.plugin.figma.prompt.handoff": "Ödeme dosyasını teslim et: ekranları, bileşenleri ve stilleri listele.",
  "marketplace.plugin.figma.prompt.audit": "Bu dosyayı tutarsız boşluk ve renk kullanımı açısından denetle.",
  "marketplace.plugin.figma.prompt.assets": "Pazarlama simgelerini uygulama paketi için 2x boyutunda dışa aktar.",
  "marketplace.plugin.paper.tagline": "HTML ve CSS üzerine kurulu tasarım tuvali",
  "marketplace.plugin.paper.description":
    "Paper, ajanların Paper Desktop'ta açık olan tasarım dosyasını okuyup yazmasına olanak tanır: çizim yüzeylerini, seçimleri, hesaplanan stilleri, JSX'i ve token'ları inceler; çerçeveler, metinler ve stiller oluşturur veya değiştirir. Başlamadan önce Paper Desktop'u yükleyin, bir kez açın ve bir dosya açın. OpenBot, Paper Desktop'un yüklediği Paper CLI'ı başlatır. Paper anahtar gerektirmez. Yazma araçları açık dosyayı değiştirir, bu yüzden her yazmayı onaylamadan önce inceleyin.",
  "marketplace.plugin.paper.app":
    "Açık Paper Desktop dosyasını, Paper CLI'ın aktardığı yerel MCP sunucusu üzerinden okur ve yazar. Bir dosyası açık Paper Desktop gerektirir.",
  "marketplace.plugin.paper.prompt.implement":
    "Seçili Paper çerçevesini bu kod tabanında, kod kurallarımıza uygun olarak uygula.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Bu depodaki stilleri kullan ve Paper'da bir ayarlar sayfası tasarla.",
  "marketplace.plugin.paper.prompt.tokens":
    "Açık Paper dosyasındaki tasarım token'larını listele ve temamızla karşılaştır.",
  "marketplace.plugin.sentry.tagline": "Hatalar ve çökme önceliklendirme",
  "marketplace.plugin.sentry.description":
    "Sentry, ajanların son hataları aramasına, yığın izlerini ve etkilenen sürümleri incelemesine ve bir dağıtımdan sonra neyin bozulduğunu özetlemesine olanak tanır. Her kullanıcı tarayıcı üzerinden kendi Sentry hesabında oturum açar.",
  "marketplace.plugin.sentry.app":
    "Hata arama, sorun inceleme ve sürüm sağlığı, tarayıcıda oturum açmayla Sentry'nin MCP sunucusu üzerinden.",
  "marketplace.plugin.sentry.prompt.newErrors": "Dünkü dağıtımdan bu yana hangi yeni hatalar çıktı?",
  "marketplace.plugin.sentry.prompt.topCrash": "Mobil projedeki en sık çökmeyi ve olası nedenini açıkla.",
  "marketplace.plugin.sentry.prompt.releaseHealth": "Güncel sürüm bir öncekine göre ne kadar sağlıklı?",
  "marketplace.plugin.context7.tagline": "Güncel kitaplık belgeleri",
  "marketplace.plugin.context7.description":
    "Context7, kitaplıklar ve çerçeveler için güncel belgeleri ve API başvurularını getirir; böylece yanıtlar projenin gerçekten çalıştırdığı sürümü kullanır. Hesap veya anahtar gerektirmez.",
  "marketplace.plugin.context7.app":
    "Güncel kitaplık belgelerinde arama, oturum açmadan Context7 MCP sunucusu üzerinden.",
  "marketplace.plugin.context7.prompt.apiCheck": "Bu çerçevede sanallaştırılmış listeler için güncel API nedir?",
  "marketplace.plugin.context7.prompt.migrate": "Bu yönlendiricinin v2 ve v3 sürümleri arasında ne değişti?",
  "marketplace.plugin.context7.prompt.example": "Kimliği doğrulanmış dosya yüklemeleri için güncel bir örnek göster.",
  "marketplace.plugin.stripe.tagline": "Ödemeler ve faturalandırma incelemesi",
  "marketplace.plugin.stripe.description":
    "Stripe, ajanların oturum açmış kullanıcının erişebildiği hesapta ödemeleri, müşterileri ve faturaları aramasına ve ödeme bağlantısı taslakları hazırlamasına olanak tanır. Her kullanıcı tarayıcı üzerinden kendi Stripe hesabında oturum açar.",
  "marketplace.plugin.stripe.app":
    "Ödeme, müşteri ve fatura arama, tarayıcıda oturum açmayla Stripe'ın MCP sunucusu üzerinden.",
  "marketplace.plugin.stripe.prompt.payment": "Bu ödemeyi bul ve neden başarısız olduğunu açıkla.",
  "marketplace.plugin.stripe.prompt.customer": "Bu müşterinin faturalarını ve ödenmemiş bakiyesini özetle.",
  "marketplace.plugin.stripe.prompt.link": "Pro planı için aylık 49 tutarında bir ödeme bağlantısı taslağı hazırla.",
  "marketplace.plugin.posthog.tagline": "Ürün analitiği ve bayraklar",
  "marketplace.plugin.posthog.description":
    "PostHog, ajanların olayları ve hunileri sorgulamasına, özellik bayraklarını incelemesine ve bir sürümden sonra neyin değiştiğini özetlemesine olanak tanır. Proje ayarlarındaki kişisel API anahtarı tek bir Authorization başlığına girer.",
  "marketplace.plugin.posthog.app":
    "Olay, huni ve özellik bayrağı erişimi, kişisel API anahtarıyla PostHog'un MCP sunucusu üzerinden.",
  "marketplace.plugin.posthog.prompt.funnel": "Son 14 günde kayıt hunisi nasıl görünüyor?",
  "marketplace.plugin.posthog.prompt.flag": "Bu kullanıcı için hangi özellik bayrakları etkin?",
  "marketplace.plugin.posthog.prompt.release": "Geçen haftaki sürümden sonra etkinleştirme değişti mi?",
  "marketplace.plugin.airtable.tagline": "Tabanlar ve kayıtlar",
  "marketplace.plugin.airtable.description":
    "Airtable, ajanların tabanları listelemesine, kayıtları okuyup güncellemesine ve tablo içeriklerini özetlemesine olanak tanır. Hesap sayfasındaki API anahtarı yerel sunucuya tek bir ortam değişkeni olarak aktarılır.",
  "marketplace.plugin.airtable.app":
    "Taban listeleme ve kayıt erişimi, Airtable API anahtarıyla yerel bir MCP sunucusu üzerinden.",
  "marketplace.plugin.airtable.prompt.bases": "Hangi tabanlara erişimim var?",
  "marketplace.plugin.airtable.prompt.records": "Lansman takip tablosunu özetle.",
  "marketplace.plugin.airtable.prompt.update":
    "Yol haritası tabanında yayınlanan özellikleri tamamlandı olarak işaretle.",
  "marketplace.plugin.firecrawl.tagline": "Web'den veri çıkarma ve arama",
  "marketplace.plugin.firecrawl.description":
    "Firecrawl, ajanların tek bir API üzerinden sayfaları kazımasına, yapılandırılmış veri çıkarmasına ve web'de arama yapmasına olanak tanır. Firecrawl panosundaki API anahtarı yerel sunucuya tek bir ortam değişkeni olarak aktarılır.",
  "marketplace.plugin.firecrawl.app":
    "Sayfa kazıma, veri çıkarma ve web araması, Firecrawl API anahtarıyla yerel bir MCP sunucusu üzerinden.",
  "marketplace.plugin.firecrawl.prompt.scrape": "Bu sayfadaki fiyat tablosunu yapılandırılmış veri olarak çıkar.",
  "marketplace.plugin.firecrawl.prompt.research": "Rakiplerin fiyatlarını araştır ve her kaynak sayfayı belirt.",
  "marketplace.plugin.firecrawl.prompt.monitor": "Bu ay değişiklik günlüğü sayfamızda ne değişti?",
  "marketplace.plugin.braveSearch.tagline": "Gizli web araması",
  "marketplace.plugin.braveSearch.description":
    "Brave Search, ajanların izleme olmadan web'de ve yerel sonuçlarda arama yapmasına olanak tanır. Brave Search API panosundaki API anahtarı yerel sunucuya tek bir ortam değişkeni olarak aktarılır.",
  "marketplace.plugin.braveSearch.app": "Web ve yerel arama, Brave API anahtarıyla yerel bir MCP sunucusu üzerinden.",
  "marketplace.plugin.braveSearch.prompt.search": "İncelemeciler bu çerçeve sürümü hakkında ne diyor?",
  "marketplace.plugin.braveSearch.prompt.news": "Bu ürün alanı için bugünkü duyuruları bul.",
  "marketplace.plugin.braveSearch.prompt.compare": "Bu iki tedarikçiyi kaynak göstererek karşılaştır.",
  "marketplace.plugin.resend.tagline": "İşlemsel e-posta",
  "marketplace.plugin.resend.description":
    "Resend, ajanların tek bir API üzerinden işlemsel e-posta göndermesine ve teslimatı kontrol etmesine olanak tanır. Resend panosundaki API anahtarı yerel sunucuya tek bir ortam değişkeni olarak aktarılır.",
  "marketplace.plugin.resend.app":
    "E-posta gönderme ve teslimat kontrolleri, Resend API anahtarıyla yerel bir MCP sunucusu üzerinden.",
  "marketplace.plugin.resend.prompt.send": "Lansman duyurusu taslağını beta listesine gönder.",
  "marketplace.plugin.resend.prompt.status": "Fatura e-postası müşteriye ulaştı mı?",
  "marketplace.plugin.resend.prompt.template": "Yeni akış için bir parola sıfırlama e-postası taslağı hazırla.",
  "marketplace.plugin.composio.tagline": "Kendi Composio bağlantınız üzerinden birçok uygulama",
  "marketplace.plugin.composio.description":
    "Composio, ajanları tek bir MCP sunucusu üzerinden Gmail, Slack, GitHub ve yüzlerce başka uygulamaya bağlar. Sunucuyu Composio hesabınızda oluşturun, istediğiniz uygulamaları ona ekleyin ve bağlantısını buraya yapıştırın. Yalnızca sunucunuz gerektiriyorsa bir API anahtarı ekleyin.",
  "marketplace.plugin.composio.app":
    "Composio MCP sunucunuza eklediğiniz uygulamalar, Composio hesabınızdaki bağlantı üzerinden.",
  "marketplace.plugin.composio.prompt.inbox":
    "Okunmamış e-postalarımı özetle ve acil olanlara yanıt taslakları hazırla.",
  "marketplace.plugin.composio.prompt.handoff": "Bu çekme isteğinin özetini ekip kanalımıza gönder.",
  "marketplace.plugin.composio.prompt.apps": "Composio üzerinden hangi uygulamaları ve eylemleri kullanabilirsin?",

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
