import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/marketplace";

export const messages = {
  // The listing: categories, rows, and the words for each kind of listing.
  "marketplace.category.coding": "Kodlama",
  "marketplace.category.design": "Tasarım",
  "marketplace.category.dataAnalytics": "Veri ve analitik",
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
  "marketplace.kinds": "Pazaryeri içerik türleri",
  "marketplace.tab.agents": "Ajanlar",
  "marketplace.tab.skills": "Beceriler",
  "marketplace.description.apps": "Ajanlarınızın çalıştığı araçları ve hizmetleri bağlayın.",
  "marketplace.description.agents": "Kendi talimatları ve becerileri olan hazır ajanlar.",
  "marketplace.description.skills": "Bir ajana bir görevi veya aracı öğreten talimatlar.",

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
  "marketplace.properties.creator": "Geliştirici",
  "marketplace.properties.category": "Kategori",
  "marketplace.properties.version": "Sürüm",
  "marketplace.properties.updated": "Güncellendi",
  "marketplace.properties.installs": "Yüklemeler",

  // Agents.
  "marketplace.agent.add": "Ekle",
  "marketplace.agent.addNamed": "Ekle: {name}",
  "marketplace.agent.addAgent": "Ajan ekle",
  "marketplace.agent.added": "Eklendi",
  "marketplace.agent.updateAvailable": "Güncelleme mevcut",
  "marketplace.agent.update": "Güncelle",
  "marketplace.agent.openChat": "Sohbeti aç",

  // Apps.
  "marketplace.app.connect": "Bağlan",
  "marketplace.app.reconnect": "Yeniden bağlan",
  "marketplace.app.connectNamed": "{name} uygulamasına bağlan",
  "marketplace.app.reconnectNamed": "{name} uygulamasına yeniden bağlan",
  "marketplace.app.connected": "Bağlandı",
  "marketplace.app.attention": "Dikkat gerekiyor",
  "marketplace.app.partialTitle": "{name} tamamlanmadı",
  "marketplace.app.partialDescription": "Bazı uygulamaları veya becerileri yüklü değil. Yeniden bağlan bunları yükler.",
  "marketplace.app.notConnected": "Bağlı değil",
  "marketplace.app.custom": "MCP sunucusu",
  "marketplace.app.githubTagline": "Depolar, sorunlar ve çekme istekleri",
  "marketplace.app.onePasswordTagline": "Paylaştığınız oturum bilgileriyle sitelerde oturum açın",
  "marketplace.app.slackTagline": "Slack'te bahsetmeler ve doğrudan mesajlar",
  "marketplace.app.discordTagline": "Discord'da bahsetmeler ve doğrudan mesajlar",
  "marketplace.app.telegramTagline": "Telegram'da gruplar ve doğrudan sohbetler",
  "marketplace.app.bitwardenTagline": "Paylaşılan bir klasördeki oturum bilgileriyle sitelerde oturum açın",
  // The category row in the 1Password page's information.
  "marketplace.app.onePasswordCategory": "Oturum açma ve kimlik bilgisi yönetimi",
  "marketplace.app.yourApps": "Uygulamalarınız",
  "marketplace.app.addCustom": "Özel ekle",
  "marketplace.app.server": "Sunucu",
  "marketplace.app.command": "Komut",
  "marketplace.app.address": "Adres",
  "marketplace.app.disconnect.title": "{name} bağlantısını kes",
  "marketplace.app.disconnect.description":
    "{name} uygulamasını ve becerilerini bu bilgisayardan kaldırın. Daha sonra tekrar bağlayabilirsiniz.",
  "marketplace.app.disconnect.action": "Bağlantıyı kes",
  "marketplace.app.remove.title": "Sunucuyu kaldır",
  "marketplace.app.remove.description": "Ajanlarınız artık bu sunucuyu kullanamaz. Ayarları silinir.",
  "marketplace.app.remove.action": "Kaldır",
  "marketplace.app.remove.confirmTitle": "{name} kaldırılsın mı?",
  "marketplace.app.remove.keep": "Koru",
  "marketplace.app.connection": "Bağlantı",
  "marketplace.app.setup.account": "Tarayıcıda {name} hesabınızla oturum açın.",
  "marketplace.app.setup.key": "{name} hesabınızdan bir API anahtarı gerekir.",
  "marketplace.app.setup.keySaved": "{field}, {host} üzerinde kayıtlı.",
  "marketplace.app.setup.desktop": "{name} masaüstü uygulamasında {address} adresinde çalışır.",
  "marketplace.app.setup.desktopConnected": "{address} adresine bağlı.",
  "marketplace.app.setup.open": "Oturum açma veya anahtar gerekmez.",
  "marketplace.app.connectAgain": "Tekrar bağlan",
  "marketplace.app.automation.askOnInstall": "Yüklerken macOS'ten erişim iste",
  "marketplace.app.automation.title": "Apple uygulamalarına erişim",
  "marketplace.app.automation.description":
    "macOS her uygulama için bir istem gösterir. Kapalı bir uygulama kısa bir süre açılır, sonra kapanır.",
  "marketplace.app.automation.request": "Erişim iste",
  "marketplace.app.automation.allowed": "OpenBot artık tüm Apple uygulamalarını kontrol edebilir.",
  "marketplace.app.automation.refused":
    "macOS şu uygulamalara erişim vermedi: {apps}. Sistem Ayarları › Gizlilik ve Güvenlik › Otomasyon'da OpenBot'a izin verin.",
  "marketplace.app.automation.failed": "OpenBot, şu uygulamalar için macOS'e soramadı: {apps}. Tekrar deneyin.",
  "marketplace.app.automation.app.calendar": "Takvim",
  "marketplace.app.automation.app.contacts": "Kişiler",
  "marketplace.app.automation.app.mail": "Mail",
  "marketplace.app.automation.app.notes": "Notlar",
  "marketplace.app.automation.app.reminders": "Anımsatıcılar",
  "marketplace.app.automation.app.messages": "Mesajlar",
  "marketplace.app.automation.app.safari": "Safari",
  "marketplace.app.signInTitle": "{name} hesabında yeniden oturum açın",
  "marketplace.app.signInDescription":
    "{name} kayıtlı oturumu reddetti. Yeniden oturum açana kadar ajanlarınız bu uygulamayı kullanamaz.",

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
  "marketplace.plugin.cobrain.tagline": "AI ajanlarınız için ortak bellek",
  "marketplace.plugin.cobrain.description":
    "Cobrain, bağladığınız her yapay zekânın okuyup yazabildiği bir Markdown belleğidir. Ajanlar çalışmadan önce bir müşterinin veya projenin bağlamını yükler, geçmiş notları ve kararları arar ve öğrendiklerini kaydeder; böylece bir sonraki konuşma, öncekinin bittiği yerden başlar. Her kullanıcı kendi Cobrain hesabında oturum açar.",
  "marketplace.plugin.cobrain.app":
    "Tek bir MCP sunucusu üzerinden Cobrain beyninizdeki notları okuma, arama ve yazma.",
  "marketplace.plugin.cobrain.prompt.startSession": "Başlamadan önce bu proje için Cobrain bağlamımı yükle.",
  "marketplace.plugin.cobrain.prompt.searchDecision":
    "Fiyatlandırma hakkında ne karar verdiğimizi Cobrain notlarımda ara.",
  "marketplace.plugin.cobrain.prompt.saveNote": "Bugün ne yaptığımızı ve neyin kaldığını Cobrain'e not olarak kaydet.",
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
    "Paper, ajanların Paper Desktop'ta açık olan tasarım dosyasını okuyup yazmasına olanak tanır: çizim yüzeylerini, seçimleri, hesaplanan stilleri, JSX'i ve token'ları inceler; çerçeveler, metinler ve stiller oluşturur veya değiştirir. Başlamadan önce Paper Desktop'u yükleyin, bir kez açın ve bir dosya açın. OpenBot, Paper Desktop'un yüklediği Paper CLI'yi başlatır. Paper anahtar gerektirmez. Yazma araçları açık dosyayı değiştirir, bu yüzden her yazmayı onaylamadan önce inceleyin.",
  "marketplace.plugin.paper.app":
    "Açık Paper Desktop dosyasını, Paper CLI'nin aktardığı yerel MCP sunucusu üzerinden okur ve yazar. Bir dosyası açık Paper Desktop gerektirir.",
  "marketplace.plugin.paper.prompt.implement":
    "Seçili Paper çerçevesini bu kod tabanında, kod kurallarımıza uygun olarak uygula.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Bu depodaki stilleri kullan ve Paper'da bir ayarlar sayfası tasarla.",
  "marketplace.plugin.paper.prompt.tokens":
    "Açık Paper dosyasındaki tasarım token'larını listele ve temamızla karşılaştır.",
  "marketplace.plugin.appleApps.tagline": "Mac'inizde Mail, Takvim ve daha fazlası",
  "marketplace.plugin.appleApps.description":
    "Apple apps, ajanların bu Mac'te Mail, Takvim, Kişiler, Anımsatıcılar, Notlar, Mesajlar ve Safari'yi kullanmasını sağlar. Yalnızca macOS'te çalışır. OpenBot, Apple veya OpenBot tarafından yapılmamış bir topluluk sunucusu olan mcp-icloud'u başlatır. Sunucu uygulamaları bu bilgisayarda AppleScript ile kontrol eder ve hesap ya da anahtar gerektirmez. Yükleme sırasında OpenBot, macOS'ten bu uygulamaların tümüne tek seferde erişim isteyebilir; her uygulama için bir istem gösterilir. İstemezseniz, bir ajan bir uygulamayı ilk kez kullandığında macOS sorar. Bunu daha sonra değiştirmek için Sistem Ayarları › Gizlilik ve Güvenlik › Otomasyon'u açın. Ajanlar e-posta ve iMessage gönderebilir, etkinlikleri, kişileri ve anımsatıcıları değiştirebilir veya silebilir; bu yüzden her yazma işlemini onaylamadan önce gözden geçirin. Araçların okuduğu içerik, örneğin e-posta metni, ajanın model sağlayıcısına gider.",
  "marketplace.plugin.appleApps.app":
    "Yerel mcp-icloud sunucusu üzerinden Mail, Takvim, Kişiler, Anımsatıcılar, Notlar, Mesajlar ve Safari. macOS ve Otomasyon izni gerekir.",
  "marketplace.plugin.appleApps.prompt.unread": "Apple Mail'deki bugünkü okunmamış e-postalarımı özetle.",
  "marketplace.plugin.appleApps.prompt.today": "Bugün ve yarın Apple Takvim'imde neler var?",
  "marketplace.plugin.appleApps.prompt.schedule":
    "Proje toplantısıyla ilgili en son e-postayı bul ve toplantıyı takvimime ekle.",
  "marketplace.plugin.sentry.tagline": "Hatalar ve çökme önceliklendirme",
  "marketplace.plugin.sentry.description":
    "Sentry, ajanların son hataları aramasına, yığın izlerini ve etkilenen sürümleri incelemesine ve bir dağıtımdan sonra neyin bozulduğunu özetlemesine olanak tanır. Her kullanıcı tarayıcı üzerinden kendi Sentry hesabında oturum açar.",
  "marketplace.plugin.sentry.app":
    "Hata arama, sorun inceleme ve sürüm sağlığı, tarayıcıda oturum açmayla Sentry'nin MCP sunucusu üzerinden.",
  "marketplace.plugin.sentry.prompt.newErrors": "Dünkü dağıtımdan bu yana hangi yeni hatalar çıktı?",
  "marketplace.plugin.sentry.prompt.topCrash": "Mobil projedeki en sık çökmeyi ve olası nedenini açıkla.",
  "marketplace.plugin.sentry.prompt.releaseHealth": "Güncel sürüm bir öncekine göre ne kadar sağlıklı?",
  "marketplace.plugin.vercel.tagline": "Dağıtımlar, derleme günlükleri ve projeler",
  "marketplace.plugin.vercel.description":
    "Vercel, ajanların projeleri ve son dağıtımları listelemesine, derleme ve çalışma zamanı günlüklerini okumasına ve bir derlemenin neden başarısız olduğunu bulmasına olanak tanır. Her kullanıcı tarayıcı üzerinden kendi Vercel hesabında oturum açar ve ajanların kullanabileceği ekipleri seçer. Bu ekiplerde ajanlar, kullanıcının hesabıyla aynı yetkilere sahiptir. Ortam değişkenlerini, alan adlarını, DNS kayıtlarını ve dağıtımları da değiştirebilir, alan adı da satın alabilirler.",
  "marketplace.plugin.vercel.app":
    "Projeler, dağıtımlar, derleme ve çalışma zamanı günlükleri, tarayıcıda oturum açmayla Vercel'in MCP sunucusu üzerinden.",
  "marketplace.plugin.vercel.prompt.failedBuild": "Son üretim dağıtımı neden başarısız oldu?",
  "marketplace.plugin.vercel.prompt.recentDeployments": "Bugünkü dağıtımları ve durumlarını listele.",
  "marketplace.plugin.vercel.prompt.runtimeErrors": "Son bir saatte hangi rotalarda çalışma zamanı hatası oluştu?",
  "marketplace.plugin.cloudflare.tagline": "Workers, DNS, depolama ve günlükler",
  "marketplace.plugin.cloudflare.description":
    "Cloudflare, ajanların Cloudflare API'si üzerinden Workers, DNS kayıtları, R2, D1 ve KV'yi listelemesini ve yönetmesini, Workers günlüklerini sorgulamasını ve Cloudflare belgelerinde arama yapmasını sağlar. Her kullanıcı tarayıcıdan kendi Cloudflare hesabına giriş yapar. Cloudflare'in onay sayfasında Read only seçeneğini seçin: varsayılan Minimal seçeneğiyle ajanlar Workers'ı, günlükleri ve DNS kayıtlarını göremez. Yazma izinleriyle ajanlar Workers dağıtabilir ve silebilir, DNS kayıtlarını değiştirebilir ve diğer hesap ayarlarını değiştirebilir.",
  "marketplace.plugin.cloudflare.app":
    "Workers, DNS, depolama ve günlükler; tarayıcıda giriş yapılan Cloudflare API MCP sunucusu üzerinden.",
  "marketplace.plugin.cloudflare.prompt.workers": "Cloudflare hesabımda hangi Workers dağıtılmış?",
  "marketplace.plugin.cloudflare.prompt.errors": "Son bir saatte hangi Cloudflare Workers hata kaydetti?",
  "marketplace.plugin.cloudflare.prompt.dns": "Cloudflare hesabımdaki her bölgenin DNS kayıtlarını listele.",
  "marketplace.plugin.supabase.tagline": "Veritabanları, günlükler ve edge function'lar",
  "marketplace.plugin.supabase.description":
    "Supabase, ajanların projeleri listelemesini, SQL çalıştırmasını, tablo şemalarını ve günlükleri okumasını, advisors güvenlik ve performans önerilerini incelemesini, edge function'ları ve dalları yönetmesini ve Supabase belgelerinde arama yapmasını sağlar. Her kullanıcı tarayıcıdan kendi Supabase hesabına giriş yapar ve bir kuruluş seçer. Ajanlar tam erişim alır: verileri değiştiren veya silen SQL çalıştırabilir, migration uygulayabilir, edge function dağıtabilir ve proje oluşturup duraklatabilir.",
  "marketplace.plugin.supabase.app":
    "Veritabanları, günlükler ve edge function'lar; tarayıcıda giriş yapılan Supabase MCP sunucusu üzerinden.",
  "marketplace.plugin.supabase.prompt.projects": "Supabase kuruluşumda hangi projeler var?",
  "marketplace.plugin.supabase.prompt.tables": "Supabase veritabanımın tablolarını ve sütunlarını listele.",
  "marketplace.plugin.supabase.prompt.errors": "Supabase projem son bir saatte hangi hataları kaydetti?",
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
    "Yol haritası tabanında yayımlanan özellikleri tamamlandı olarak işaretle.",
  "marketplace.plugin.firecrawl.tagline": "Web'den veri çıkarma ve arama",
  "marketplace.plugin.firecrawl.description":
    "Firecrawl, ajanların tek bir API üzerinden sayfaları kazımasına, yapılandırılmış veri çıkarmasına ve web'de arama yapmasına olanak tanır. Firecrawl panosundaki API anahtarı yerel sunucuya tek bir ortam değişkeni olarak aktarılır.",
  "marketplace.plugin.firecrawl.app":
    "Sayfa kazıma, veri çıkarma ve web araması, Firecrawl API anahtarıyla yerel bir MCP sunucusu üzerinden.",
  "marketplace.plugin.firecrawl.prompt.scrape": "Bu sayfadaki fiyat tablosunu yapılandırılmış veri olarak çıkar.",
  "marketplace.plugin.firecrawl.prompt.research": "Rakiplerin fiyatlarını araştır ve her kaynak sayfayı belirt.",
  "marketplace.plugin.firecrawl.prompt.monitor": "Bu ay değişiklik günlüğü sayfamızda ne değişti?",
  "marketplace.plugin.braveSearch.tagline": "Gizlilik odaklı web araması",
  "marketplace.plugin.braveSearch.description":
    "Brave Search, ajanların izleme olmadan web'de ve yerel sonuçlarda arama yapmasına olanak tanır. Brave Search API panosundaki API anahtarı yerel sunucuya tek bir ortam değişkeni olarak aktarılır.",
  "marketplace.plugin.braveSearch.app": "Web ve yerel arama, Brave API anahtarıyla yerel bir MCP sunucusu üzerinden.",
  "marketplace.plugin.braveSearch.prompt.search": "İncelemeciler bu çerçeve sürümü hakkında ne diyor?",
  "marketplace.plugin.braveSearch.prompt.news": "Bu ürün alanı için bugünkü duyuruları bul.",
  "marketplace.plugin.braveSearch.prompt.compare": "Bu iki tedarikçiyi kaynak göstererek karşılaştır.",
  "marketplace.plugin.obsidian.tagline": "Kasandaki notlar",
  "marketplace.plugin.obsidian.description":
    "Obsidian, ajanların kasandaki notları aramasını, okumasını ve yazmasını sağlar; böylece kasa onların hafızası olabilir. Yerel sunucu, bu bilgisayardaki Obsidian uygulamasında bulunan Local REST API eklentisine bağlanır. Eklentinin API anahtarı yerel sunucuya tek bir ortam değişkeni olarak aktarılır. Ajanlar kullanırken Obsidian'ı açık tut.",
  "marketplace.plugin.obsidian.app":
    "Local REST API eklentisinin anahtarıyla yerel bir MCP sunucusu üzerinden not arama, okuma ve düzenleme.",
  "marketplace.plugin.obsidian.prompt.recall": "Notlarım bu projedeki kararlar hakkında ne diyor?",
  "marketplace.plugin.obsidian.prompt.save": "Bu kararı kasamda yeni bir not olarak kaydet.",
  "marketplace.plugin.obsidian.prompt.log": "Bugünkü çalışmanın özetini İş günlüğü notuma ekle.",
  "marketplace.plugin.obsidian.hint.apiKey":
    'Obsidian\'da Settings > Local REST API bölümünü aç. API anahtarını kopyala ve "Enable non-encrypted (HTTP) server" seçeneğini aç.',
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
    "Composio, ajanları tek bir MCP sunucusu üzerinden Gmail, Slack, GitHub ve yüzlerce başka uygulamaya bağlar. İstediğiniz uygulamaları Composio hesabınızda bağlayın, ardından MCP URL'sini ve API anahtarını buraya yapıştırın.",
  "marketplace.plugin.composio.app":
    "Composio MCP sunucunuza eklediğiniz uygulamalar, Composio hesabınızdaki bağlantı üzerinden.",
  "marketplace.plugin.composio.prompt.inbox":
    "Okunmamış e-postalarımı özetle ve acil olanlara yanıt taslakları hazırla.",
  "marketplace.plugin.composio.prompt.handoff": "Bu çekme isteğinin özetini ekip kanalımıza gönder.",
  "marketplace.plugin.composio.prompt.apps": "Composio üzerinden hangi uygulamaları ve eylemleri kullanabilirsin?",
  "marketplace.plugin.composio.hint.url": "Composio hesabınızdaki bir MCP sunucusunun URL'si",
  "marketplace.plugin.composio.hint.apiKey":
    "Composio hesabınızda, Settings > Sessions & API Key altında bulabilirsiniz.",
  "marketplace.plugin.neon.tagline": "Postgres projeleri, dalları ve geçişleri",
  "marketplace.plugin.neon.description":
    "Neon, ajanların projeleri ve dalları listelemesine, SQL çalıştırmasına, tablo şemalarını okumasına, şema değişikliklerini geçici bir dalda test etmesine, yavaş sorguları bulmasına ve Neon belgelerinde arama yapmasına olanak tanır. Her kullanıcı tarayıcı üzerinden kendi Neon hesabında oturum açar ve yetki verirken salt okunur erişimi seçebilir. Tam erişimle ajanlar verileri değiştiren veya silen SQL çalıştırabilir; dalları, veritabanlarını ve projeleri oluşturabilir, sıfırlayabilir veya silebilir. Neon, MCP sunucusunu üretim veritabanları için değil, geliştirme ve test için önerir.",
  "marketplace.plugin.neon.app":
    "Postgres projeleri, dalları, SQL ve geçişler, tarayıcıda oturum açmayla Neon'un MCP sunucusu üzerinden.",
  "marketplace.plugin.neon.prompt.projects": "Neon hesabımda hangi projeler ve dallar var?",
  "marketplace.plugin.neon.prompt.slowQueries": "Neon veritabanımda en yavaş sorgular hangileri ve neden?",
  "marketplace.plugin.neon.prompt.migration":
    "Geçici bir dalda orders tablosuna bir dizin ekle ve uygulamadan önce sonucu bana göster.",
  "marketplace.plugin.prisma.tagline": "Postgres veritabanları, yedekler ve Compute uygulamaları",
  "marketplace.plugin.prisma.description":
    "Prisma, ajanların Prisma Postgres veritabanlarını listelemesine ve oluşturmasına, şemaları okumasına, SQL çalıştırmasına, yedekleri listeleyip yeni bir veritabanına geri yüklemesine, Object Storage kovalarını yönetmesine, Compute derlemelerini ve günlüklerini okumasına ve Prisma belgelerinde arama yapmasına olanak tanır. Her kullanıcı tarayıcı üzerinden kendi Prisma hesabında oturum açar ve bir çalışma alanı seçer. Ajanlar tam erişim alır: verileri değiştiren veya silen SQL çalıştırabilir, şemaları güncelleyebilir, veritabanlarını ve kovaları silebilir, Compute dağıtımlarını durdurabilir, geri alabilir veya silebilirler.",
  "marketplace.plugin.prisma.app":
    "Veritabanları, SQL, yedekler ve Compute uygulamaları, tarayıcıda oturum açmayla Prisma'nın MCP sunucusu üzerinden.",
  "marketplace.plugin.prisma.prompt.databases": "Prisma çalışma alanımda hangi veritabanları var?",
  "marketplace.plugin.prisma.prompt.backups": "Veritabanımın kullanılabilir tüm yedeklerini bana göster.",
  "marketplace.plugin.prisma.prompt.logs": "En son Compute dağıtımımın çalışma zamanı günlüklerini göster.",
  "marketplace.plugin.netlify.tagline": "Projeler, dağıtımlar ve istek günlükleri",
  "marketplace.plugin.netlify.description":
    "Netlify, ajanların projeleri ve dağıtımları listelemesine, uç istek günlüklerini okumasına, proje oluşturmasına ve mevcut bir projeye kod dağıtmasına olanak tanır. Her kullanıcı tarayıcı üzerinden kendi Netlify hesabında oturum açar. Ajanlar, kullanıcının hesabıyla aynı erişime sahiptir: ortam değişkenlerini, formları ve ziyaretçi erişimini değiştirebilir, uzantı kurabilir veya kaldırabilir, form gönderimlerini ve ortam değişkenlerini silebilirler.",
  "marketplace.plugin.netlify.app":
    "Projeler, dağıtımlar, istek günlükleri ve site ayarları, tarayıcıda oturum açmayla Netlify'ın MCP sunucusu üzerinden.",
  "marketplace.plugin.netlify.prompt.latestDeploy": "Netlify projelerimin her birinde en son dağıtımın durumu nedir?",
  "marketplace.plugin.netlify.prompt.errors": "Son bir günde sitemin hangi URL'leri sunucu hatası döndürdü?",
  "marketplace.plugin.netlify.prompt.deploy": "Bu klasörü mevcut Netlify projeme dağıt.",
  "marketplace.plugin.railway.tagline": "Projeler, servisler ve dağıtımlar",
  "marketplace.plugin.railway.description":
    "Railway, ajanların projeleri ve servisleri listelemesine, proje oluşturmasına, servisleri yeniden dağıtmasına ve özellik bayraklarını yönetmesine olanak tanır. Ajanlar çok adımlı işleri Railway Agent'a da verebilir. Railway Agent günlükleri okur, bir dağıtımın neden başarısız olduğunu bulur, servis oluşturur ve değişken ayarlar. Her kullanıcı tarayıcı üzerinden kendi Railway hesabında oturum açar ve ajanların kullanabileceği çalışma alanlarını ve projeleri seçer. Bu projelerde ajanlar tam erişime sahiptir: hazırlanan değişiklikleri dağıtabilir, özellik bayraklarını silebilir ve Railway Agent üzerinden servisleri, değişkenleri, veritabanlarını ve ağı değiştirebilirler.",
  "marketplace.plugin.railway.app":
    "Projeler, servisler ve dağıtımlar, tarayıcıda oturum açmayla Railway'in MCP sunucusu üzerinden.",
  "marketplace.plugin.railway.prompt.projects": "Railway çalışma alanımda hangi projeler ve servisler var?",
  "marketplace.plugin.railway.prompt.crash": "Railway'deki backend servisim dağıtımda neden çöküyor?",
  "marketplace.plugin.railway.prompt.redeploy": "Railway projemdeki API servisini yeniden dağıt.",
  "marketplace.plugin.render.tagline": "Servisler, dağıtımlar ve günlükler",
  "marketplace.plugin.render.description":
    "Render, ajanların çalışma alanlarını ve servisleri listelemesine, günlükleri, olayları ve metrikleri okumasına, dağıtım geçmişini görmesine, dağıtım başlatmasına ve Render Postgres üzerinde salt okunur SQL çalıştırmasına olanak tanır. Bir Render API anahtarı tek bir Authorization başlığına girer. Anahtar, Render hesabının tüm çalışma alanlarına erişir. Ajanlar web servisleri, statik siteler, cron işleri, Postgres veritabanları ve Key Value örnekleri oluşturabilir; bunlar ücretli olabilir. Ayrıca bir servisin ortam değişkenlerini değiştirebilirler. Sunucu hiçbir kaynağı silemez.",
  "marketplace.plugin.render.app":
    "Servisler, dağıtımlar, günlükler ve metrikler, API anahtarıyla Render'ın MCP sunucusu üzerinden.",
  "marketplace.plugin.render.prompt.services": "Render çalışma alanımda hangi servisler var?",
  "marketplace.plugin.render.prompt.logs": "Render web servisim son bir saatte hangi hataları günlüğe yazdı?",
  "marketplace.plugin.render.prompt.deploy": "Render servisimin son dağıtımı neden başarısız oldu?",
  "marketplace.plugin.atlassian.tagline": "Jira iş öğeleri ve Confluence sayfaları",
  "marketplace.plugin.atlassian.description":
    "Atlassian, ajanların Jira iş öğelerini, Confluence sayfalarını ve Bitbucket çekme isteklerini aramasına ve okumasına, iş öğeleri, sayfalar ve yorumlar oluşturmasına veya güncellemesine olanak tanır. Her kullanıcı tarayıcı üzerinden kendi Atlassian hesabında oturum açar ve erişimi bir onay ekranında onaylar. Ajanlar kullanıcıyla aynı yetkilere sahiptir: iş öğelerini ve sayfaları değiştirebilir, sayfa izinlerini değiştirebilir ve çekme isteklerini birleştirebilirler. Jira verilerini silen araçlar, bir kuruluş yöneticisi açana kadar kapalı kalır. Her araç çağrısı Rovo kredisi kullanır.",
  "marketplace.plugin.atlassian.app":
    "Jira, Confluence ve Bitbucket, tarayıcıda oturum açmayla Atlassian'ın MCP sunucusu üzerinden.",
  "marketplace.plugin.atlassian.prompt.assigned": "Bana atanmış açık Jira iş öğeleri hangileri?",
  "marketplace.plugin.atlassian.prompt.releasePage": "Sürüm sürecimizle ilgili Confluence sayfasını bul ve özetle.",
  "marketplace.plugin.atlassian.prompt.newItem":
    "Oturum açma hatası için yeniden oluşturma adımlarıyla bir Jira iş öğesi oluştur.",
  "marketplace.plugin.todoist.tagline": "Görevler, projeler ve hatırlatıcılar",
  "marketplace.plugin.todoist.description":
    "Todoist, ajanların görevleri tarihe, metne, etikete veya filtreye göre bulmasını, görev eklemesini ve yeniden planlamasını, projeleri, bölümleri, etiketleri, yorumları ve hatırlatıcıları yönetmesini sağlar. Her kullanıcı tarayıcıda kendi Todoist hesabıyla oturum açar. Ajanlar okuma ve yazma erişimi alır: görevleri, projeleri ve diğer öğeleri değiştirebilir, tamamlayabilir ve silebilir.",
  "marketplace.plugin.todoist.app":
    "Görevler, projeler ve hatırlatıcılar, tarayıcıda oturum açmayla Todoist'in MCP sunucusu üzerinden.",
  "marketplace.plugin.todoist.prompt.today": "Bugün hangi Todoist görevlerinin süresi doluyor?",
  "marketplace.plugin.todoist.prompt.capture": "Bu yapılacak maddeleri Todoist Gelen Kutuma ekle.",
  "marketplace.plugin.todoist.prompt.overdue": "Geciken Todoist görevlerimi yarına taşı.",
  "marketplace.plugin.trello.tagline": "Panolar, listeler ve kartlar",
  "marketplace.plugin.trello.description":
    "Trello ile ajanlar panoları, listeleri, kartları, kontrol listelerini ve yorumları arayıp okur, pano ve kart oluşturur, listeleri ve kartları taşır, kartları tamamlandı olarak işaretler ve kontrol listesi, yorum ve etiket ekler. Ajanlar ayrıca kullanıcının Trello Gelen Kutusu'ndaki kartları okuyup kart ekleyebilir ve bağlı bir Google veya Outlook takviminden gelebilen Planner etkinliklerini okuyabilir. Her kullanıcı tarayıcıda kendi Trello hesabına giriş yapar ve bir onay ekranında çalışma alanlarını seçer. Ajanlar bu çalışma alanlarında kullanıcıyla aynı izinlere sahiptir. Kartları ve listeleri arşivleyebilirler, ancak sunucu hiçbir şeyi kalıcı olarak silemez.",
  "marketplace.plugin.trello.app":
    "Panolar, listeler ve kartlar, tarayıcıda giriş yapılan Trello MCP sunucusu üzerinden.",
  "marketplace.plugin.trello.prompt.myCards": "Bana hangi Trello kartları atanmış?",
  "marketplace.plugin.trello.prompt.board": "Trello panomda devam eden işleri özetle.",
  "marketplace.plugin.trello.prompt.newCards": "Bu yapılacak maddeleri Trello panoma kart olarak ekle.",
  "marketplace.plugin.huggingface.tagline": "Hub'daki modeller, veri kümeleri ve makaleler",
  "marketplace.plugin.huggingface.description":
    "Hugging Face, ajanların Hugging Face Hub'da modelleri, veri kümelerini, Spaces'i, koleksiyonları ve makaleleri aramasına, model kartlarını ve depo dosyalarını okumasına, veri kümelerini önizlemesine ve Hugging Face belgelerinde arama yapmasına olanak tanır. Herkese açık Hub verilerini kullanır ve hesap ya da anahtar gerektirmez. Araçlar yalnızca okur: ajanlar depo oluşturamaz ve iş (job) çalıştıramaz.",
  "marketplace.plugin.huggingface.app":
    "Model, veri kümesi, Space, makale ve belge araması, oturum açmadan Hugging Face'in MCP sunucusu üzerinden.",
  "marketplace.plugin.huggingface.prompt.models": "Hugging Face'te konuşma tanıma için küçük açık modeller bul.",
  "marketplace.plugin.huggingface.prompt.papers": "Bugün Hugging Face'te hangi makaleler gündemde?",
  "marketplace.plugin.huggingface.prompt.dataset":
    "Hava durumu zaman serilerinden oluşan bir veri kümesi bul ve sütunlarını göster.",
  "marketplace.auth.apiKey": "API anahtarı",
  "marketplace.auth.personalApiKey": "Kişisel API anahtarı",
  "marketplace.auth.mcpUrl": "MCP URL'si",
  "marketplace.auth.createKey": "Anahtar oluştur",

  // Skills. {label} is the install button text: an agent name, "All agents" or "2 agents".
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "{name} içinde dene",
  "marketplace.skills.yours": "Becerileriniz",
  "marketplace.skills.seeAll": "Tümünü gör",
  "marketplace.skills.seeAllName": "Tümünü gör: {name}",
  "marketplace.skills.none": "Henüz hiçbir ajanın becerisi yok.",
  "marketplace.skills.noneHint":
    "Beceri, bir ajana tek bir görevi öğretir. Aşağıdan bir beceri ekleyin veya kendi becerinizi oluşturun.",
  "marketplace.skills.sourceLabel": "Kaynak",
  "marketplace.skills.source.all": "Tümü",
  "marketplace.skills.source.verified": "Doğrulanmış",
  "marketplace.skills.source.public": "Herkese açık",
  "marketplace.skills.source.verifiedLong": "OpenBot tarafından doğrulandı",
  "marketplace.skills.source.publicLong": "Herkese açık: OpenBot bunu kontrol etmedi",
  "marketplace.skills.sortLabel": "Sırala",
  "marketplace.skills.sortName": "Sırala: {name}",
  "marketplace.skills.sort.installs": "En çok kullanılan",
  "marketplace.skills.sort.updated": "Son güncellenen",
  "marketplace.skills.sort.name": "Ad",
  "marketplace.skills.featured": "Öne çıkanlar",
  "marketplace.skills.all": "Tüm beceriler",
  "marketplace.skills.count": { one: "{count} beceri", other: "{count} beceri" },
  "marketplace.skills.searchIn": "{name} içinde ara",
  "marketplace.skills.state.off": "Kapalı",
  "marketplace.skills.state.repair": "Onarılmalı",
  "marketplace.skills.state.update": "Güncelleme var",
  "marketplace.skills.state.modified": "Sizin tarafınızdan değiştirildi",
  "marketplace.skills.stateOn": "{agents}: {state}",
  "marketplace.skills.version": "Sürüm {version}",
  "marketplace.skills.origin.local": "Bu bilgisayarda oluşturuldu",
  "marketplace.skills.origin.workspace": "Bu ajanın klasöründe",
  "marketplace.skills.origin.marketplace": "Pazaryerinden · sürüm {version}",
  "marketplace.skills.status.notAdded": "Eklenmedi",
  "marketplace.skills.status.on": "Açık: {agents}",
  "marketplace.skills.agentCount": { one: "{count} ajan", other: "{count} ajan" },
  "marketplace.skills.allAgents": "tüm ajanlar",
  "marketplace.skills.agentsTitle": "Ajanlar · {total}",
  "marketplace.skills.agents.search": "Ajan ara",
  "marketplace.skills.agents.searchName": "{name} becerisine sahip ajanları ara",
  "marketplace.skills.agents.noMatch": "“{query}” ile eşleşen ajan yok.",
  "marketplace.skills.agents.removeAll": "Tümünü kaldır",
  "marketplace.skills.agents.removeAllName": {
    one: "{name} becerisini {count} ajandan kaldır",
    other: "{name} becerisini tüm {count} ajandan kaldır",
  },
  "marketplace.skills.agent.toggle": "{agent} için {name}",
  "marketplace.skills.agent.remove": "Kaldır",
  "marketplace.skills.agent.removeName": "{name} becerisini kaldır: {agent}",
  "marketplace.skills.add": "Ekle",
  "marketplace.skills.addName": "{name} becerisini ajanlara ekle",
  "marketplace.skills.addToAgents": "Ajanlara ekle",
  "marketplace.skills.onOf": "{total} ajandan {have} tanesinde açık",
  "marketplace.skills.chooseAgents": "{name} şu ajanlarda var: {agents}. Ajanları seç",
  "marketplace.skills.dialog.list": "{name} becerisine sahip ajanlar",
  "marketplace.skills.dialog.search": { one: "{count} ajan içinde ara", other: "{count} ajan içinde ara" },
  "marketplace.skills.dialog.all": { one: "{count} ajan", other: "Tüm {count} ajan" },
  "marketplace.skills.dialog.allMatches": { one: "{count} eşleşme", other: "Tüm {count} eşleşme" },
  "marketplace.skills.dialog.checked": "{checked} / {total}",
  "marketplace.skills.dialog.save": "Kaydet",
  "marketplace.skills.dialog.saveBoth": "Kaydet: {added} ekle, {removed} kaldır",
  "marketplace.skills.dialog.addTo": "Ekle: {agents}",
  "marketplace.skills.dialog.removeFrom": "Kaldır: {agents}",
  "marketplace.skills.dialog.full": "Beceri sınırına ulaşıldı",
  "marketplace.skills.dialog.unread": "Beceriler okunamadı",
  "marketplace.skills.local.gone": "Şu anda hiçbir ajanda bu beceri yok.",

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
    "{name} uygulamasını bu ajanları çalıştıran bilgisayara yükleyin: uygulaması tarayıcıda oturum açmayı gerektirir.",
  "marketplace.error.appInvalid": "{name} eklenemiyor: {reason}",
  "marketplace.error.uninstallNoServer": "Bir eklentiyi kaldırmak için yerel bir sunucu seçin.",
  "marketplace.error.uninstallPartial": "{name} uygulamasının bazı kısımları kaldırılamadı. {failures}",
  "marketplace.error.actionFailed": "Pazaryeri eylemi tamamlanamadı. Tekrar deneyin.",
  "marketplace.thisAgent": "bu ajan",
} as const satisfies PartialTranslation<typeof source>;
