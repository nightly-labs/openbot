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
  "marketplace.agents.routineInactive": "Devre dışı",
  "marketplace.agents.by": "{name} tarafından",
  "marketplace.agents.routineCount": { one: "{count} rutin", other: "{count} rutin" },
  "marketplace.agents.yours": "Ajanlarınız",
  "marketplace.agents.all": "Tüm ajanlar",
  "marketplace.agents.missing": "Bu ajan Pazaryerinde yok.",
  "marketplace.agents.trust.reviewed":
    "Başka bir OpenBot kullanıcısı tarafından yapıldı. OpenBot yayınlanmadan önce inceledi.",
  "marketplace.agents.trust.reviewedBeforeAdd":
    "Başka bir OpenBot kullanıcısı tarafından yapıldı. OpenBot yayınlanmadan önce inceledi. Eklendiğinde sizin adınıza işlem yapabilir.",
  "marketplace.agents.trust.pending": "OpenBot incelemeden önce yapan kişi tarafından paylaşıldı.",
  "marketplace.agents.trust.pendingBeforeAdd":
    "OpenBot incelemeden önce yapan kişi tarafından paylaşıldı. Eklendiğinde sizin adınıza işlem yapabilir.",
  "marketplace.agents.source.pending": "Henüz incelenmedi",

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
  "marketplace.app.whatsappTagline": "WhatsApp'ta kendi sohbetiniz ve izin verdiğiniz kişiler",
  "marketplace.app.bitwardenTagline": "Paylaşılan bir klasördeki oturum bilgileriyle sitelerde oturum açın",
  "marketplace.app.protonPassTagline": "Paylaşılan bir kasadaki oturum bilgileriyle sitelerde oturum açın",
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
  "marketplace.app.access.use": "Kullanabilir",
  "marketplace.app.access.noAgents": "Ajan yok",
  "marketplace.app.access.agentsOf": "{name} kullanabilen ajanlar",
  "marketplace.app.access.chooseAgents": "{name}: {summary}. Ajanları seç",
  "marketplace.app.access.level": "{role} rolünün {name} erişimi",
  "marketplace.app.setup.account": "Tarayıcıda {name} hesabınızla oturum açın.",
  "marketplace.app.setup.key": "{name} hesabınızdan bir API anahtarı gerekir.",
  "marketplace.app.setup.keySaved": "{field}, {host} üzerinde kayıtlı.",
  "marketplace.app.account.removeDescription": "OpenBot bu hesabın oturum bilgilerini {host} üzerinde siler.",
  "marketplace.app.setup.desktop": "{name} masaüstü uygulamasında {address} adresinde çalışır.",
  "marketplace.app.setup.desktopConnected": "{address} adresine bağlı.",
  "marketplace.app.setup.open": "Oturum açma veya anahtar gerekmez.",
  "marketplace.app.blocked.update":
    "{host} uygulama bağlayamayan eski bir OpenBot sürümü çalıştırıyor. {host} üzerindeki OpenBot'u güncelleyin veya sahibinden güncellemesini isteyin.",
  "marketplace.app.blocked.member":
    "{host} üzerinde yalnızca bir sahip veya yönetici uygulama bağlayabilir. Onlardan {name} uygulamasını bağlamalarını ya da üyelerin uygulama bağlayabilmesi için {host} üzerindeki OpenBot'u güncellemelerini isteyin.",
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
  "marketplace.plugin.honcho.tagline": "Tüm yapay zekâ araçlarında hafızanız",
  "marketplace.plugin.honcho.description":
    "Plastic Labs'in Honcho'su, ajanlara sizinle ilgili, bağladığınız diğer yapay zekâ araçlarının da paylaşabileceği uzun süreli bir hafıza verir. Ajanlar öğrendiklerini kaydeder, Honcho da bunlar üzerinde akıl yürüterek tercihlerinizin, hedeflerinizin ve çalışma biçimlerinizin bir modelini oluşturur. Ajanlar başlamadan önce ona sorular sorar. OpenBot ajanlarının kendi hafızası da vardır; Honcho sizi diğer araçlara da izleyen hafızadır. Ajanların kaydettiği mesajlar Honcho hesabınıza gider.",
  "marketplace.plugin.honcho.app":
    "Tek bir MCP sunucusu üzerinden Honcho çalışma alanlarınızda uzun süreli hafızayı kaydedin ve sorgulayın.",
  "marketplace.plugin.honcho.prompt.recall":
    "Başlamadan önce Honcho'ya nasıl çalışmayı sevdiğim hakkında ne bildiğini sor.",
  "marketplace.plugin.honcho.prompt.save": "Bu konudaki kararları Honcho'ya kaydet.",
  "marketplace.plugin.honcho.prompt.preferences": "Honcho yazım tarzım hakkında ne diyor? Bu taslakta bunu kullan.",
  "marketplace.plugin.honcho.hint.apiKey": "app.honcho.dev adresinde bir anahtar oluşturun.",
  "marketplace.plugin.hindsight.tagline": "Zamanla öğrenen hafıza",
  "marketplace.plugin.hindsight.description":
    "Vectorize'ın Hindsight'ı, ajanlara Hindsight Cloud'da uzun süreli bir hafıza verir. Ajanlar olguları ve olayları saklar, onları anlam, zaman ve varlığa göre hatırlar ve zihinsel modeller oluşturmak için üzerlerinde düşünür. Anılar bankalarda tutulur ve ajanlar her proje ya da kişi için bir banka oluşturabilir. OpenBot ajanlarının kendi hafızası da vardır; Hindsight, bağladığınız diğer yapay zekâ araçlarının paylaşabileceği hafızadır. Ajanların sakladıkları Hindsight Cloud hesabınıza gider.",
  "marketplace.plugin.hindsight.app":
    "Tek bir MCP sunucusu üzerinden Hindsight Cloud bankalarınızdaki anıları saklayın, hatırlayın ve üzerinde düşünün.",
  "marketplace.plugin.hindsight.prompt.recall":
    "Başlamadan önce Hindsight'tan bu proje hakkında bildiklerimizi hatırla.",
  "marketplace.plugin.hindsight.prompt.retain": "Bu konudaki kararları ve açık soruları Hindsight'ta sakla.",
  "marketplace.plugin.hindsight.prompt.reflect":
    "Hindsight'taki anılarım üzerinde düşün: son bir aydaki çalışmamda hangi örüntüleri görüyorsun?",
  "marketplace.plugin.hindsight.hint.apiKey": "Hindsight Cloud'un Connect sayfasında bir anahtar oluşturun.",
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
  "marketplace.plugin.higgsfield.tagline": "Yapay zekâ ile görsel, video ve ses",
  "marketplace.plugin.higgsfield.description":
    "Higgsfield, ajanların Seedance, Kling, Veo ve MiniMax Hailuo gibi Higgsfield modelleriyle görsel, video, karakter ve ses üretmesini, kredi bakiyesini kontrol etmesini ve Asset Library'ye göz atmasını sağlar. Sonuçlar kullanıcının Higgsfield Assets alanına kaydedilir. Her kullanıcı tarayıcıda kendi Higgsfield hesabına giriş yapar. Her üretim, sınırsız planda da o hesabın kredilerini standart ücretle kullanır.",
  "marketplace.plugin.higgsfield.app":
    "Higgsfield MCP sunucusu üzerinden, tarayıcıda girişle görsel, video ve ses üretimi, karakterler, krediler ve varlıklar.",
  "marketplace.plugin.higgsfield.prompt.credits": "Kaç Higgsfield kredim var?",
  "marketplace.plugin.higgsfield.prompt.productShot":
    "Higgsfield ile ahşap masa üzerinde seramik bir kupanın ürün fotoğrafını yap.",
  "marketplace.plugin.higgsfield.prompt.clip": "Higgsfield ile gün batımında dalgaların 5 saniyelik bir videosunu yap.",
  "marketplace.plugin.elevenlabs.tagline": "Konuşma, sesler ve sesli ajanlar",
  "marketplace.plugin.elevenlabs.description":
    "ElevenLabs, ajanların metni konuşmaya çevirmesini, seslerle çalışmasını ve ElevenLabs sesli ajanlarını ve konuşmalarını oluşturmasını, test etmesini ve incelemesini sağlar. Üretilen ses kısa ömürlü bir indirme bağlantısı olarak gelir. Her kullanıcı tarayıcıda kendi ElevenLabs hesabına giriş yapar ve her üretim o hesabın kredilerini kullanır.",
  "marketplace.plugin.elevenlabs.app":
    "Metinden konuşmaya, sesler ve sesli ajan yönetimi, tarayıcıda giriş ile ElevenLabs'in MCP sunucusu üzerinden.",
  "marketplace.plugin.elevenlabs.prompt.speech": "Bu paragrafı sakin bir ElevenLabs sesiyle oku ve sesi bana ver.",
  "marketplace.plugin.elevenlabs.prompt.agents": "ElevenLabs sesli ajanlarımı ve her birinin kullandığı sesi listele.",
  "marketplace.plugin.elevenlabs.prompt.conversations": "Destek sesli ajanımın son on konuşmasını özetle.",
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
  "marketplace.plugin.gitlab.tagline": "Sorunlar, birleştirme istekleri ve işlem hatları",
  "marketplace.plugin.gitlab.description":
    "GitLab, ajanların GitLab.com'da projeleri aramasına, sorunları okuyup oluşturmasına, birleştirme isteklerini incelemesine ve güncellemesine, depo dosyalarını ve commit'leri okumasına, CI işlem hatlarını ve işlerini kontrol etmesine olanak tanır. Her kullanıcı tarayıcı üzerinden kendi GitLab hesabında oturum açar. Ajanlar kullanıcıyla aynı izinlere sahiptir: commit gönderebilir, sorunları ve birleştirme isteklerini değiştirebilir ve bunları birleştirebilir. Kendi sunucunuzdaki GitLab için MCP sunucuları ayarlarında GitLab adresinizin sonuna /api/v4/mcp eklenmiş bir sunucu ekleyin ve orada oturum açın.",
  "marketplace.plugin.gitlab.app":
    "Projeler, sorunlar, birleştirme istekleri, depolar ve CI işlem hatları, tarayıcıda oturum açmayla GitLab'in MCP sunucusu üzerinden.",
  "marketplace.plugin.gitlab.prompt.reviewQueue": "Hangi birleştirme istekleri incelememi bekliyor?",
  "marketplace.plugin.gitlab.prompt.failedPipeline": "Varsayılan daldaki son işlem hattı neden başarısız oldu?",
  "marketplace.plugin.gitlab.prompt.newIssue":
    "Eşitleme kuyruğundaki çökme için yeniden oluşturma adımlarıyla bir sorun kaydı aç.",
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
  "marketplace.plugin.revenuecat.tagline": "Abonelikler, ürünler ve paywall'lar",
  "marketplace.plugin.revenuecat.description":
    "RevenueCat, ajanların uygulama içi aboneliklerinizin ayarlarını okumasını ve değiştirmesini sağlar: uygulamalar, ürünler, entitlement'lar, offering'ler, paketler, paywall'lar ve deneyler. Ajanlar müşterileri ve satın alımlarını da arayabilir, grafikleri ve metrikleri okuyabilir. Gizli bir RevenueCat API anahtarı tek bir Authorization başlığına girer. Anahtar bir projeye erişir. Salt okunur bir anahtarla ajanlar yalnızca okuyabilir. Yazma anahtarıyla ajanlar ürünleri App Store incelemesine gönderebilir, müşterilere entitlement verebilir ve paketleri, hedefleme kurallarını ve webhook'ları silebilir.",
  "marketplace.plugin.revenuecat.app":
    "Gizli bir API anahtarıyla RevenueCat'in MCP sunucusu üzerinden ürünler, entitlement'lar, offering'ler, paywall'lar ve metrikler.",
  "marketplace.plugin.revenuecat.prompt.offerings": "RevenueCat projemde hangi offering'ler ve paketler var?",
  "marketplace.plugin.revenuecat.prompt.revenue": "Bu ay RevenueCat gelirim ve aktif aboneliklerim nasıl değişti?",
  "marketplace.plugin.revenuecat.prompt.customer":
    "Bu RevenueCat müşterisinin hangi entitlement'ları var ve ne zaman sona eriyorlar?",
  "marketplace.plugin.revenuecat.hint.apiKey":
    "RevenueCat panelinde projenizin API keys sayfasını açın ve gizli bir API anahtarı oluşturun. Verileri görmek için salt okunur bir anahtar yeterlidir.",
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
  "marketplace.plugin.omnisend.tagline": "E-posta ve SMS pazarlaması",
  "marketplace.plugin.omnisend.description":
    "Omnisend, ajanların kampanya ve form raporlarını okumasını, kişileri ve segmentleri bulmasını, kampanyalar, otomasyonlar, e-posta şablonları, formlar ve ürünler oluşturup düzenlemesini sağlar. Her kullanıcı tarayıcıda kendi Omnisend hesabına giriş yapar ve onay ekranında erişim düzeyini seçer. Yazma erişimiyle ajanlar kampanya da gönderebilir ve veri silebilir. Ajanlar yalnızca rapora ihtiyaç duyuyorsa salt okunur erişimi seç.",
  "marketplace.plugin.omnisend.app":
    "Kampanyalar, otomasyonlar, kişiler, segmentler, formlar ve raporlar; tarayıcıda giriş ile Omnisend'in MCP sunucusu üzerinden.",
  "marketplace.plugin.omnisend.prompt.lastCampaign":
    "Geçen haftanın kampanyaları bir önceki haftaya göre nasıl performans gösterdi?",
  "marketplace.plugin.omnisend.prompt.segment": "VIP segmentinde kaç kişi var ve bu ay nasıl değişti?",
  "marketplace.plugin.omnisend.prompt.draftCampaign": "Yeni koleksiyon için bir kampanya taslağı hazırla ama gönderme.",
  "marketplace.plugin.postiz.tagline": "Sosyal medya planlama",
  "marketplace.plugin.postiz.description":
    "Postiz, ajanların sosyal medya kanallarınızı listelemesini ve X, LinkedIn, Instagram ve TikTok gibi 30'dan fazla ağda gönderi taslağı hazırlamasını, planlamasını ve yayımlamasını sağlar. Ajanlar ayrıca medya yükleyebilir ve yapay zekâ ile görsel ve video oluşturabilir. Postiz hesabınıza tarayıcıdan giriş yapın veya Postiz'deki Settings › Developers bölümünden API anahtarını yapıştırın. Tüm Postiz bulut planları API erişimi içerir. Ajanlar bir gönderiyi hemen yayımlayabilir, bu yüzden her gönderiyi onaylamadan önce inceleyin.",
  "marketplace.plugin.postiz.app":
    "Kanallar, taslaklar, planlanmış gönderiler ve medya; tarayıcıdan giriş veya API anahtarıyla Postiz'in MCP sunucusu üzerinden.",
  "marketplace.plugin.postiz.prompt.channels": "Postiz'e hangi sosyal medya kanalları bağlı?",
  "marketplace.plugin.postiz.prompt.week": "Gelecek hafta için hangi gönderiler planlandı?",
  "marketplace.plugin.postiz.prompt.draft":
    "Yeni sürümümüz hakkında bir LinkedIn gönderisi taslağı hazırla, ama planlama.",
  "marketplace.plugin.composio.tagline": "Gmail, Slack, GitHub ve 1.000'den fazla uygulama",
  "marketplace.plugin.composio.description":
    "Composio, ajanlarınızı tek bir MCP sunucusu üzerinden Gmail, Slack, GitHub ve 1.000'den fazla başka uygulamaya bağlar. Composio hesabınızla oturum açın. Bir ajanın bir uygulamaya ihtiyacı olduğunda, o uygulamayı bağlamanızı ister.",
  "marketplace.plugin.composio.app":
    "Composio hesabınızda bağladığınız uygulamalar. Bir ajan, ihtiyaç duyduğunda bir uygulamayı bağlamanızı ister.",
  "marketplace.plugin.composio.prompt.inbox":
    "Okunmamış e-postalarımı özetle ve acil olanlara yanıt taslakları hazırla.",
  "marketplace.plugin.composio.prompt.handoff": "Bu çekme isteğinin özetini ekip kanalımıza gönder.",
  "marketplace.plugin.composio.prompt.apps": "Composio üzerinden hangi uygulamaları ve eylemleri kullanabilirsin?",
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
  "marketplace.plugin.ticktick.tagline": "Görevler, listeler, alışkanlıklar ve odak",
  "marketplace.plugin.ticktick.description":
    "TickTick, ajanların görevleri aramasını ve filtrelemesini, görev ekleyip değiştirmesini ve listeleri, bölümleri, klasörleri, etiketleri ve yorumları yönetmesini sağlar. Ajanlar alışkanlıkları ve odak kayıtlarını da okuyup değiştirebilir ve TickTick'e bağlı takvimlerdeki etkinlikleri okuyabilir. Her kullanıcı tarayıcıda kendi TickTick hesabına giriş yapar. Ajanlar okuma ve yazma erişimi alır: görevleri tamamlayabilir, taşıyabilir ve silebilir, etiketleri ve odak kayıtlarını silebilir.",
  "marketplace.plugin.ticktick.app":
    "Görevler, listeler, alışkanlıklar ve odak kayıtları, tarayıcıda girişle TickTick'in MCP sunucusu üzerinden.",
  "marketplace.plugin.ticktick.prompt.today": "Bugün hangi TickTick görevlerinin süresi doluyor?",
  "marketplace.plugin.ticktick.prompt.capture": "Bu eylem maddelerini TickTick Gelen Kutuma ekle.",
  "marketplace.plugin.ticktick.prompt.week": "Geçen hafta hangi TickTick görevlerini tamamladım?",
  "marketplace.plugin.trello.tagline": "Panolar, listeler ve kartlar",
  "marketplace.plugin.trello.description":
    "Trello ile ajanlar panoları, listeleri, kartları, kontrol listelerini ve yorumları arayıp okur, pano ve kart oluşturur, listeleri ve kartları taşır, kartları tamamlandı olarak işaretler ve kontrol listesi, yorum ve etiket ekler. Ajanlar ayrıca kullanıcının Trello Gelen Kutusu'ndaki kartları okuyup kart ekleyebilir ve bağlı bir Google veya Outlook takviminden gelebilen Planner etkinliklerini okuyabilir. Her kullanıcı tarayıcıda kendi Trello hesabına giriş yapar ve bir onay ekranında çalışma alanlarını seçer. Ajanlar bu çalışma alanlarında kullanıcıyla aynı izinlere sahiptir. Kartları ve listeleri arşivleyebilirler, ancak sunucu hiçbir şeyi kalıcı olarak silemez.",
  "marketplace.plugin.trello.app":
    "Panolar, listeler ve kartlar, tarayıcıda giriş yapılan Trello MCP sunucusu üzerinden.",
  "marketplace.plugin.trello.prompt.myCards": "Bana hangi Trello kartları atanmış?",
  "marketplace.plugin.trello.prompt.board": "Trello panomda devam eden işleri özetle.",
  "marketplace.plugin.trello.prompt.newCards": "Bu yapılacak maddeleri Trello panoma kart olarak ekle.",
  "marketplace.plugin.clickup.tagline": "Görevler, belgeler ve ekip güncellemeleri",
  "marketplace.plugin.clickup.description":
    "ClickUp, ajanların görevlerde, belgelerde, yorumlarda ve sohbetlerde arama yapmasını, görev, liste ve belge oluşturup güncellemesini, yorum eklemesini, sohbet mesajı göndermesini ve süre kaydetmesini sağlar. Her kullanıcı tarayıcıdan kendi ClickUp hesabında oturum açar. Ajanlar kullanıcıyla aynı izinlere sahip olur. Görevleri çöp kutusuna taşıyabilir ve yorumları silebilirler.",
  "marketplace.plugin.clickup.app":
    "Görevler, belgeler, yorumlar, sohbet ve süre takibi; tarayıcıda oturum açılan ClickUp MCP sunucusu üzerinden.",
  "marketplace.plugin.clickup.prompt.findTasks": "Bu hafta süresi dolan açık ClickUp görevlerimi bul.",
  "marketplace.plugin.clickup.prompt.createTask": "Bu yapılacak maddelerden bir ClickUp görevi oluştur ve bana ata.",
  "marketplace.plugin.clickup.prompt.summarizeDoc":
    "ClickUp'taki en son proje güncellemesini bul ve açık soruları özetle.",
  "marketplace.plugin.coinbase.tagline": "Kripto fiyatları, portföyler ve alım satım",
  "marketplace.plugin.coinbase.description":
    "Coinbase, ajanların Coinbase Advanced Trade'deki fiyatları, bakiyeleri, portföyleri, emirleri ve ücretleri okumasını, emirleri önizleyip vermesini, varlıklar arasında dönüşüm yapmasını ve portföyler arasında fon taşımasını sağlar. Her kullanıcı tarayıcıda kendi Coinbase hesabına giriş yapar. Ajanlar kullanıcıyla aynı izinlere sahiptir. Emirler ve dönüşümler gerçek fon kullanır ve ajanlar x402 isteklerinin ücretini USDC bakiyesinden ödeyebilir.",
  "marketplace.plugin.coinbase.app":
    "Fiyatlar, bakiyeler, portföyler, emirler ve dönüşümler; Coinbase'in MCP sunucusu ve tarayıcıda giriş ile.",
  "marketplace.plugin.coinbase.prompt.balances": "Coinbase'de her portföydeki bakiyelerim nedir?",
  "marketplace.plugin.coinbase.prompt.price": "Coinbase'de BTC-USD fiyatını ve bu hafta nasıl hareket ettiğini göster.",
  "marketplace.plugin.coinbase.prompt.previewOrder":
    "Coinbase'de 50 USD'lik piyasa fiyatından ETH alımını önizle. Emri verme.",
  "marketplace.plugin.robinhood.tagline": "Aracı kurum hesapları ve ajanlarla alım satım",
  "marketplace.plugin.robinhood.description":
    "Robinhood, ajanların bir Robinhood müşterisinin hesaplarını, pozisyonlarını, bakiyelerini, işlem geçmişini ve izleme listelerini ve piyasa verilerini okumasını, hisse senedi, opsiyon ve kripto emirleri vermesini sağlar. Her kullanıcı tarayıcıda kendi Robinhood hesabına giriş yapar. İlk girişte Robinhood, kullanıcıdan ayrı bir Agentic hesabı açmasını ister. Ajanlar yalnızca o hesapta işlem yapabilir ve varsayılan olarak her emir için kullanıcı onayı istemeden emir verir.",
  "marketplace.plugin.robinhood.app":
    "Hesaplar, pozisyonlar, piyasa verileri ve işlemler; Robinhood'un MCP sunucusu ve tarayıcıda giriş ile.",
  "marketplace.plugin.robinhood.prompt.positions":
    "Robinhood pozisyonlarımı ve bugün nasıl hareket ettiklerini özetle.",
  "marketplace.plugin.robinhood.prompt.watchlist": "Robinhood izleme listemdeki her hisse bu hafta nasıl hareket etti?",
  "marketplace.plugin.robinhood.prompt.agenticCash": "Robinhood Agentic hesabımda ne kadar nakit var?",
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
  "marketplace.skills.source.publicLong": "OpenBot tarafından incelendi",
  "marketplace.skills.sortLabel": "Sırala",
  "marketplace.skills.sortName": "Sırala: {name}",
  "marketplace.skills.sort.installs": "En çok kullanılan",
  "marketplace.skills.sort.updated": "Son güncellenen",
  "marketplace.skills.sort.name": "Ad",
  "marketplace.skills.featured": "Öne çıkanlar",
  "marketplace.skills.all": "Tüm beceriler",
  "marketplace.skills.count": { one: "{count} beceri", other: "{count} beceri" },
  "marketplace.skills.searchIn": "{name} içinde ara",
  "marketplace.skills.missing": "Bu beceri Pazaryerinde yok.",
  "marketplace.skills.state.off": "Kapalı",
  "marketplace.skills.state.repair": "Onarılmalı",
  "marketplace.skills.state.update": "Güncelleme var",
  "marketplace.skills.state.modified": "Sizin tarafınızdan değiştirildi",
  "marketplace.skills.stateOn": "{agents}: {state}",
  "marketplace.skills.version": "Sürüm {version}",
  "marketplace.skills.origin.local": "Bu bilgisayarda oluşturuldu",
  "marketplace.skills.origin.workspace": "Bu ajanın klasöründe",
  "marketplace.skills.origin.marketplace": "Pazaryerinden · sürüm {version}",
  "marketplace.skills.origin.github": "GitHub'dan · {repository}",
  "marketplace.skills.github.search": "Arayın veya bir GitHub bağlantısı yapıştırın",
  "marketplace.skills.github.reading": "Depoda beceriler aranıyor",
  "marketplace.skills.github.trust": "OpenBot, GitHub'daki becerileri incelemedi. Bir beceriyi eklemeden önce okuyun.",
  "marketplace.skills.github.source": "GitHub · {repository}, {commit} işlemesi",
  "marketplace.skills.github.open": "GitHub",
  "marketplace.skills.github.openName": "{repository} deposunu GitHub'da aç",
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
