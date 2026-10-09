import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/connector";

export const messages = {
  // Sunucu ayarları > Bağlayıcılar: bu bilgisayarın yerleşik GitHub bağlantısı.
  "connector.github.title": "GitHub",
  "connector.github.description":
    "Bu bilgisayardaki her ajan GitHub depolarınızı, sorunlarınızı (issues), çekme isteklerinizi (pull requests), gh ve git araçlarını kullanabilir.",
  "connector.github.connect": "GitHub'a Bağlan",
  "connector.github.pendingTitle": "Bu kodu GitHub'a yazın",
  "connector.github.pendingDescription": "GitHub tarayıcınızda açıldı. Bağlanmak için kodu oraya yazın.",
  "connector.github.waiting": "GitHub bekleniyor",
  "connector.github.copyCode": "Kodu kopyala",
  "connector.github.codeCopied": "Kopyalandı",
  "connector.github.openGitHub": "GitHub'ı Aç",
  "connector.github.cancel": "İptal",
  "connector.github.connectedAs": "@{login} olarak bağlandı",
  "connector.github.repositoriesTitle": "Depolar",
  "connector.github.repositoriesDescription":
    "Ajanlar yalnızca OpenBot GitHub Uygulamasının yüklü olduğu depoları kullanabilir.",
  "connector.github.chooseRepositories": "Depoları seç",
  "connector.github.repositoriesLoading": "Depolar GitHub'dan okunuyor",
  "connector.github.repositoriesFailed": "OpenBot depoları GitHub'dan okuyamadı.",
  "connector.github.noRepositories": "OpenBot GitHub Uygulaması henüz bir depoya yüklenmedi.",
  // {count} bir sayıdır (örneğin 12).
  "connector.github.moreRepositories": {
    one: "Ve {count} depo daha",
    other: "Ve {count} depo daha",
  },
  // Yalnızca üyelerinin görebileceği bir deponun yanındaki rozet.
  "connector.github.private": "Gizli",
  "connector.github.disconnect": "Bağlantıyı Kes",
  "connector.github.disconnectTitle": "GitHub Bağlantısını Kes",
  "connector.github.disconnectSummary": "Tüm ajanlar GitHub erişimini kaybeder. Sohbetleriniz ve dosyalarınız kalır.",
  "connector.github.expiredTitle": "GitHub bağlantısının süresi doldu",
  "connector.github.expiredDescription": "Ajanlara yeniden GitHub erişimi vermek için @{login} olarak tekrar bağlanın.",
  "connector.github.reconnect": "Yeniden Bağlan",
  "connector.github.actionFailed": "OpenBot GitHub bağlantısını değiştiremedi.",
  // GitHub sayfasının üst kısmındaki adın yanındaki durum.
  "connector.github.statusConnected": "Bağlandı",
  "connector.github.statusConnecting": "Bağlanıyor",
  "connector.github.statusExpired": "Süresi doldu",
  "connector.github.statusNotSetUp": "Ayarlanmadı",
  "connector.github.accountTitle": "Hesap",
  // {count} listedeki depo sayısıdır (örneğin 12).
  "connector.github.filterPlaceholder": {
    one: "{count} depoyu filtrele",
    other: "{count} depoyu filtrele",
  },
  "connector.github.filterLabel": "Depoları filtrele",
  // {query} kullanıcının filtreye yazdığı metindir.
  "connector.github.noMatch": "“{query}” ile eşleşen depo bulunamadı.",
  // Bağlanma iletişim kutusu. Adımlar sayı olarak gösterilir; ekran okuyucular adları okur.
  "connector.github.stepSignIn": "Giriş yap",
  "connector.github.stepConnected": "Bağlandı",
  "connector.github.requestingCode": "OpenBot GitHub'dan bir kod istiyor.",
  // {code} GitHub'a yazılacak koddur (örneğin WDJB-MJHT).
  "connector.github.codeLabel": "Kod {code}",
  "connector.github.failedTitle": "GitHub bağlanamadı",
  "connector.github.cancelConnecting": "GitHub bağlantısını iptal et",
  // {count} ajanların kullanabileceği depo sayısıdır.
  "connector.github.connectedSummary": {
    one: "{count} depo · bu bilgisayardaki her ajan",
    other: "{count} depo · bu bilgisayardaki her ajan",
  },
  "connector.github.done": "Bitti",
  "connector.github.later": "Daha sonra",
  // Bağlantıyı kesme öncesi onay. {login} GitHub hesap adıdır (örneğin octocat).
  "connector.github.disconnectConfirmTitle": "GitHub bağlantısı kesilsin mi?",
  "connector.github.disconnectConfirmDescription": "Bağlantıyı kesmek @{login} oturumunu bu bilgisayardan kaldırır.",
  "connector.github.disconnectEffectTools": "Tüm ajanlar GitHub araçlarını, gh ve git erişimini kaybeder.",
  "connector.github.disconnectEffectRevoke": "Ardından OpenBot yetkisini kaldırabileceğiniz GitHub açılır.",
  "connector.github.disconnectEffectKept": "Sohbetler, dosyalar ve ajan hafızası bu bilgisayarda kalır.",
  "connector.github.keepConnected": "Bağlı kal",
  "connector.github.close": "Kapat",
  // Bir entegrasyon sayfasının onu kaldıran eylemi içeren son bölümü.
  "connector.dangerZone": "Tehlikeli bölge",

  // Sunucu ayarları > Bağlayıcılar: entegrasyonlar listesi. Her satır kendi sayfasını açar.
  "connector.hub.onThisComputer": "Bu bilgisayarda",
  "connector.hub.notSetUp": "Ayarlanmadı",
  "connector.hub.available": "Kullanılabilir",
  // {name} Slack gibi bir entegrasyonun adıdır.
  "connector.hub.open": "{name} uygulamasını aç",
  "connector.hub.setUp": "Ayarla",
  "connector.hub.back": "Tüm bağlayıcılar",
  // {names} "Chief, Research" gibi ajanları listeler.
  "connector.hub.usedBy": "{names} tarafından kullanılıyor",

  // Sunucu ayarları > Bağlayıcılar > Slack: bir çalışma alanı tek OpenBot uygulamasını yükler ve Slack
  // Düzenleyicisi ajanı her isteği alır, ekibe sorar ve yanıtlar.
  "connector.slack.title": "Slack",
  "connector.slack.description":
    "Kullanıcılar Slack'te @OpenBot'tan bahseder veya doğrudan mesaj gönderir. Slack Düzenleyicisi doğru ajana sorar ve yanıtlar.",
  "connector.slack.statusNotSetUp": "Ayarlanmadı",
  "connector.slack.statusConnected": "Bağlandı",
  "connector.slack.statusAttention": "İlgilenilmesi gerekiyor",
  // {workspace} Slack çalışma alanı adıdır.
  "connector.slack.summaryConnected": "{workspace} · Slack Düzenleyicisi yanıtlıyor",
  "connector.slack.summaryNoAgent": "{workspace} · Henüz yanıt veren bir ajan yok",
  "connector.slack.attentionTitle": {
    one: "{count} çalışma alanının ilgilenilmesi gerekiyor",
    other: "{count} çalışma alanının ilgilenilmesi gerekiyor",
  },
  "connector.slack.attentionDescription": "Aşağıdaki durum ne yapılması gerektiğini belirtir.",
  "connector.slack.connect": "Slack'e Bağlan",
  "connector.slack.addAgent": "Ajan ekle",
  "connector.slack.actionFailed": "Slack değişikliği kabul etmedi",
  "connector.slack.workspaceTitle": "Çalışma alanı",
  "connector.slack.workspaceDescription": "Kullanıcılar @OpenBot'tan bahseder veya doğrudan mesaj gönderir.",
  "connector.slack.disconnectWorkspace": "Bağlantıyı Kes",
  "connector.slack.missingScopes":
    "OpenBot Slack'te şu izinlere sahip değil: {scopes}. Çalışma alanı bağlantısını kesin, ardından tekrar bağlayın.",
  "connector.slack.retryAt": "Slack OpenBot'tan beklemesini istedi. {time} saatinde tekrar deneyecek.",
  "connector.slack.reconnect": "Yeniden Bağlan",
  "connector.slack.resume": "Sürdür",
  // {action} Pause gibi bir düğmedir; {name} çalışma alanı adıdır.
  "connector.slack.rowAction": "{action}: {name}",
  "connector.slack.orchestratorTitle": "Slack Düzenleyicisi",
  "connector.slack.orchestratorDescription":
    "Bu ajan Slack'ten gelen her isteği alır. Kısa olanları kendisi yanıtlar, diğer işleri doğru ajana iletir ve yanıtı ileti dizisinde yayınlar.",
  "connector.slack.orchestratorNone": "Henüz yanıt veren bir ajan yok",
  "connector.slack.orchestratorNoneDescription": "Slack Düzenleyicisini ekleyin, aksi takdirde Slack yanıt alamaz.",
  "connector.slack.inviteNote":
    "OpenBot her genel kanala ve her yeni kanala kendiliğinden katılır. Özel bir kanal için onu davet edin: /invite @OpenBot.",
  // Bağlanma iletişim kutusu. Adımlar sayı olarak gösterilir; ekran okuyucular adları okur.
  "connector.slack.stepWorkspace": "Çalışma alanı",
  "connector.slack.stepAgent": "Ajan",
  "connector.slack.connectTitle": "Bir Slack çalışma alanına bağlanın",
  "connector.slack.connectDescription":
    "OpenBot çalışma alanına OpenBot adında bir uygulama yükler ve her genel kanala katılır.",
  "connector.slack.connectStepBrowser": "Slack tarayıcınızda açılır",
  "connector.slack.connectStepAllow": "Sağ üst köşeden çalışma alanını seçin, ardından İzin Ver'e tıklayın",
  "connector.slack.connectStepReturn": "Slack işlemi tamamlandığında bu iletişim kutusu devam eder",
  "connector.slack.connectInSlack": "Slack'te Bağlan",
  "connector.slack.connectWaiting": "Slack bekleniyor. Kurulumu tarayıcınızda tamamlayın.",
  "connector.slack.agentStepTitle": "Slack Düzenleyicisini ekleyin",
  // {workspace} Slack çalışma alanı adıdır.
  "connector.slack.agentStepDescription": "Bu yeni ajan, {workspace} içinde @OpenBot'a gönderilen her şeyi yanıtlar.",
  "connector.slack.orchestratorName": "Slack Düzenleyicisi",
  "connector.slack.orchestratorRole": "Slack'te yanıt verir ve ekibe sorar",
  "connector.slack.orchestratorDoesReceive": "Her Slack isteğini ilk olarak alır",
  "connector.slack.orchestratorDoesDelegate": "Her görevi en uygun ajana iletir",
  "connector.slack.orchestratorDoesAnswer": "Yanıtı Slack ileti dizisinde yayınlar",
  "connector.slack.orchestratorModel": "Model",
  "connector.slack.doneTitle": "OpenBot {workspace} içinde",
  "connector.slack.doneDescription": "Herhangi bir genel kanalda @OpenBot'tan bahsedin veya doğrudan mesaj gönderin.",
  "connector.slack.done": "Bitti",
  "connector.slack.disconnectTitle": "{workspace} bağlantısı kesilsin mi?",
  "connector.slack.disconnectDescription":
    "OpenBot {workspace} içinde yanıt vermeyi durdurur ve Slack token'ını bu bilgisayardan kaldırır.",
  "connector.slack.disconnectEffect": "{workspace} içindeki kişiler artık @OpenBot aracılığıyla ajanlarınıza ulaşamaz.",
  "connector.slack.removeEffectKept": "Konuşmalar ve Slack Düzenleyicisi OpenBot'ta kalır.",
  "connector.slack.keep": "Bağlı tut",
  "connector.slack.close": "Kapat",

  // Sunucu ayarları > Bağlayıcılar > Discord: bir Discord sunucusu tek OpenBot botunu ekler ve Discord
  // Düzenleyicisi ajanı her isteği alır, ekibe sorar ve yanıtlar. Her zaman "Discord sunucusu" yazın.
  "connector.discord.title": "Discord",
  "connector.discord.description":
    "Kullanıcılar bir Discord sunucusunun kanalında @OpenBot'tan bahseder. Discord Düzenleyicisi doğru ajana sorar ve yanıtlar.",
  "connector.discord.statusNotSetUp": "Ayarlanmadı",
  "connector.discord.statusConnected": "Bağlandı",
  "connector.discord.statusAttention": "İlgilenilmesi gerekiyor",
  // {workspace} Discord sunucusunun adıdır.
  "connector.discord.summaryConnected": "{workspace} · Discord Düzenleyicisi yanıtlıyor",
  "connector.discord.summaryNoAgent": "{workspace} · Henüz yanıt veren bir ajan yok",
  "connector.discord.attentionTitle": {
    one: "{count} Discord sunucusunun ilgilenilmesi gerekiyor",
    other: "{count} Discord sunucusunun ilgilenilmesi gerekiyor",
  },
  "connector.discord.attentionDescription": "Aşağıdaki durum ne yapılması gerektiğini belirtir.",
  "connector.discord.connect": "Discord'a Bağlan",
  "connector.discord.addAgent": "Ajan ekle",
  "connector.discord.actionFailed": "Discord değişikliği kabul etmedi",
  "connector.discord.workspaceTitle": "Discord sunucusu",
  "connector.discord.workspaceDescription":
    "Bir kanalda @OpenBot'tan bahsedin. Devam etmek için OpenBot'a yanıt verin.",
  "connector.discord.disconnectWorkspace": "Bağlantıyı Kes",
  "connector.discord.missingScopes":
    "OpenBot Discord'da şu izinlere sahip değil: {scopes}. Discord sunucusu bağlantısını kesin, ardından tekrar bağlayın.",
  "connector.discord.retryAt": "Discord OpenBot'tan beklemesini istedi. {time} saatinde tekrar deneyecek.",
  "connector.discord.reconnect": "Yeniden Bağlan",
  "connector.discord.resume": "Sürdür",
  // {action} Pause gibi bir düğmedir; {name} Discord sunucusunun adıdır.
  "connector.discord.rowAction": "{action}: {name}",
  "connector.discord.orchestratorTitle": "Discord Düzenleyicisi",
  "connector.discord.orchestratorDescription":
    "Bu ajan Discord'dan gelen her isteği alır. Kısa olanları kendisi yanıtlar, diğer işleri doğru ajana iletir ve yanıtı kanalda verir.",
  "connector.discord.orchestratorNone": "Henüz yanıt veren bir ajan yok",
  "connector.discord.orchestratorNoneDescription":
    "Discord Düzenleyicisini ekleyin, aksi takdirde Discord yanıt alamaz.",
  "connector.discord.channelsNote": "OpenBot, rolünün görebildiği kanalları görür.",
  // Bağlanma iletişim kutusu. Adımlar sayı olarak gösterilir; ekran okuyucular adları okur.
  "connector.discord.stepWorkspace": "Discord sunucusu",
  "connector.discord.stepAgent": "Ajan",
  "connector.discord.connectTitle": "Bir Discord sunucusuna bağlanın",
  "connector.discord.connectDescription": "OpenBot, Discord sunucusuna OpenBot adında bir bot ekler.",
  "connector.discord.connectStepBrowser": "Discord tarayıcınızda açılır",
  "connector.discord.connectStepAllow": "Sunucuyu seçin, ardından Yetkilendir'e tıklayın",
  "connector.discord.connectStepReturn": "Discord işlemi tamamlandığında bu iletişim kutusu devam eder",
  "connector.discord.connectInDiscord": "Discord'da Bağlan",
  "connector.discord.connectWaiting": "Discord bekleniyor. Yetkilendirmeyi tarayıcınızda tamamlayın.",
  "connector.discord.agentStepTitle": "Discord Düzenleyicisini ekleyin",
  // {workspace} Discord sunucusunun adıdır.
  "connector.discord.agentStepDescription": "Bu yeni ajan, {workspace} içinde @OpenBot'a gönderilen her şeyi yanıtlar.",
  "connector.discord.orchestratorName": "Discord Düzenleyicisi",
  "connector.discord.orchestratorRole": "Discord'da yanıt verir ve ekibe sorar",
  "connector.discord.orchestratorDoesReceive": "Her Discord isteğini ilk olarak alır",
  "connector.discord.orchestratorDoesDelegate": "Her görevi en uygun ajana iletir",
  "connector.discord.orchestratorDoesAnswer": "Yanıtı Discord kanalında verir",
  "connector.discord.orchestratorModel": "Model",
  "connector.discord.doneTitle": "OpenBot {workspace} içinde",
  "connector.discord.doneDescription": "Bir kanalda @OpenBot'tan bahsedin. Devam etmek için OpenBot'a yanıt verin.",
  "connector.discord.done": "Bitti",
  "connector.discord.disconnectTitle": "{workspace} bağlantısı kesilsin mi?",
  "connector.discord.disconnectDescription":
    "OpenBot {workspace} içinde yanıt vermeyi bırakır ve Discord bağlantısını bu bilgisayardan kaldırır.",
  "connector.discord.disconnectEffect":
    "{workspace} içindeki kişiler artık @OpenBot aracılığıyla ajanlarınıza ulaşamaz.",
  "connector.discord.removeEffectKept": "Konuşmalar ve Discord Düzenleyicisi OpenBot'ta kalır.",
  "connector.discord.keep": "Bağlı tut",
  "connector.discord.close": "Kapat",
  // Sunucu ayarları > Bağlayıcılar > Telegram: her sohbet tek OpenBot botunu ekler ve Telegram
  // Düzenleyicisi ajanı tüm sohbetlerin mesajlarını alır, ekibe sorar ve yanıtlar.
  "connector.telegram.title": "Telegram",
  "connector.telegram.description":
    "OpenBot botunu bir Telegram grubuna ekleyin veya botla doğrudan bir sohbet açın. Telegram Düzenleyicisi doğru ajana sorar ve yanıtlar.",
  "connector.telegram.statusNotSetUp": "Ayarlanmadı",
  "connector.telegram.statusConnected": "Bağlandı",
  "connector.telegram.statusAttention": "İlgilenilmesi gerekiyor",
  // {count} bağlı Telegram sohbetlerinin sayısıdır.
  "connector.telegram.summaryConnected": {
    one: "{count} sohbet · Telegram Düzenleyicisi yanıtlıyor",
    other: "{count} sohbet · Telegram Düzenleyicisi yanıtlıyor",
  },
  "connector.telegram.summaryNoAgent": {
    one: "{count} sohbet · Henüz yanıt veren bir ajan yok",
    other: "{count} sohbet · Henüz yanıt veren bir ajan yok",
  },
  "connector.telegram.attentionTitle": {
    one: "{count} sohbetin ilgilenilmesi gerekiyor",
    other: "{count} sohbetin ilgilenilmesi gerekiyor",
  },
  "connector.telegram.attentionDescription": "Aşağıdaki durum ne yapılması gerektiğini belirtir.",
  "connector.telegram.connect": "Telegram'a Bağlan",
  "connector.telegram.addAgent": "Ajan ekle",
  "connector.telegram.actionFailed": "Telegram değişikliği kabul etmedi",
  "connector.telegram.chatsTitle": "Sohbetler",
  "connector.telegram.groupDescription": "Kullanıcılar bottan bahseder veya mesajlarını yanıtlar.",
  "connector.telegram.directDescription": "Bu sohbetteki her mesaj Telegram Düzenleyicisine gider.",
  "connector.telegram.helpRemoved":
    "OpenBot botu artık bu sohbette değil. Sohbetin bağlantısını kesin, sonra botu yeniden ekleyin.",
  "connector.telegram.helpRelayUnavailable":
    "OpenBot bu bilgisayarda Telegram mesajlarını alamıyor. Oturum açın, Sunucu ayarlarında bu bilgisayara bir ad verin ve OpenBot'u açık tutun.",
  "connector.telegram.helpError": "OpenBot bu sohbete ulaşamıyor. Yeniden bağlanın veya sohbetin bağlantısını kesin.",
  "connector.telegram.retryAt": "Telegram OpenBot'tan beklemesini istedi. {time} saatinde tekrar deneyecek.",
  "connector.telegram.pause": "Duraklat",
  "connector.telegram.resume": "Sürdür",
  "connector.telegram.reconnect": "Yeniden Bağlan",
  "connector.telegram.disconnectChat": "Bağlantıyı Kes",
  // {action} Pause gibi bir düğmedir; {name} sohbet adıdır.
  "connector.telegram.rowAction": "{action}: {name}",
  "connector.telegram.linkTitle": "Başka bir sohbet bağlayın",
  "connector.telegram.linkDescription": "Telegram tarayıcınızda açılır. Sohbet bağlandığında burada görünür.",
  "connector.telegram.linkWaiting": "Telegram bekleniyor. Telegram'da sohbeti seçin.",
  "connector.telegram.addToGroup": "Bir gruba ekle",
  "connector.telegram.openDirectChat": "Doğrudan sohbet aç",
  "connector.telegram.orchestratorTitle": "Telegram Düzenleyicisi",
  "connector.telegram.orchestratorDescription":
    "Bu ajan tüm Telegram sohbetlerinizden OpenBot'a gelen mesajları alır. Kısa olanları kendisi yanıtlar, diğer işleri doğru ajana iletir ve yanıtı sohbette yayınlar.",
  "connector.telegram.orchestratorNone": "Henüz yanıt veren bir ajan yok",
  "connector.telegram.orchestratorNoneDescription":
    "Telegram Düzenleyicisini ekleyin, aksi takdirde Telegram yanıt alamaz.",
  "connector.telegram.mentionNote":
    "Bir grupta bottan bahsedin veya mesajlarını yanıtlayın. Doğrudan sohbette her mesaj bota gider.",
  // Bağlanma iletişim kutusu. Adımlar sayı olarak gösterilir; ekran okuyucular adları okur.
  "connector.telegram.stepChat": "Sohbet",
  "connector.telegram.stepAgent": "Ajan",
  "connector.telegram.connectTitle": "Bir Telegram sohbeti bağlayın",
  "connector.telegram.connectDescription":
    "OpenBot botunu bir gruba ekleyin veya botla doğrudan bir sohbet açın. Tek bir bot tüm sohbetlerinize hizmet eder.",
  "connector.telegram.connectStepBrowser": "Telegram tarayıcınızda açılır",
  "connector.telegram.connectStepPick": "Grubu seçin veya doğrudan sohbette Başlat'a dokunun",
  "connector.telegram.connectStepReturn": "Sohbet bağlandığında bu iletişim kutusu devam eder",
  "connector.telegram.connectWaiting": "Telegram bekleniyor. Telegram'da sohbeti seçin.",
  "connector.telegram.agentStepTitle": "Telegram Düzenleyicisini ekleyin",
  // {chat} Telegram sohbetinin adıdır.
  "connector.telegram.agentStepDescription":
    "Bu yeni ajan, {chat} içinde ve daha sonra bağladığınız her sohbette OpenBot'a gelen mesajları yanıtlar.",
  "connector.telegram.orchestratorName": "Telegram Düzenleyicisi",
  "connector.telegram.orchestratorRole": "Telegram'da yanıt verir ve ekibe sorar",
  "connector.telegram.orchestratorDoesReceive": "OpenBot'a gelen her Telegram mesajını ilk olarak alır",
  "connector.telegram.orchestratorDoesDelegate": "Her görevi en uygun ajana iletir",
  "connector.telegram.orchestratorDoesAnswer": "Yanıtı Telegram sohbetinde yayınlar",
  "connector.telegram.orchestratorModel": "Model",
  "connector.telegram.doneTitle": "OpenBot {chat} içinde",
  "connector.telegram.done": "Bitti",
  "connector.telegram.disconnectTitle": "{chat} bağlantısı kesilsin mi?",
  "connector.telegram.disconnectDescription":
    "OpenBot botu {chat} sohbetinden ayrılır ve OpenBot orada yanıt vermeyi bırakır. Konuşmalar OpenBot'ta kalır.",
  "connector.telegram.disconnectEffect":
    "{chat} içindeki kişiler artık OpenBot botu aracılığıyla ajanlarınıza ulaşamaz.",
  "connector.telegram.removeEffectKept": "Konuşmalar ve Telegram Düzenleyicisi OpenBot'ta kalır.",
  "connector.telegram.keep": "Bağlı tut",
  "connector.telegram.close": "Kapat",
} as const satisfies PartialTranslation<typeof source>;
