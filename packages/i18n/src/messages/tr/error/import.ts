import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  // Agent import errors and warnings.
  "error.import.manifestNotJson": "{manifest} geçerli bir JSON değil.",
  "error.import.notAgentExport": "{manifest} bir OpenBot ajan dışa aktarımı değil.",
  "error.import.newerExportSkill":
    "Bu dışa aktarım daha yeni bir dışa aktarma becerisi tarafından yapıldı. OpenBot'u güncelleyip tekrar deneyin.",
  "error.import.noAgents": "Dışa aktarım hiçbir ajan içermiyor.",
  "error.import.tooManyAgents": "Dışa aktarım {limit} ajandan fazlasını içeriyor.",
  "error.import.tooManyChannels": "Dışa aktarım {limit} kanaldan fazlasını içeriyor.",
  "error.import.channelSkipped": "{name}: kanaldaki ajanların hiçbiri dışa aktarımda bulunmadığından kanal atlandı.",
  "error.import.membersLeftOut": "{name}: bu dışa aktarımda ajan olmayan üyeler dışarıda bırakıldı.",
  "error.import.leadNotMember": "{name}: lider bir üye değil, bu yüzden kanalın lideri yok.",
  "error.import.routineLimit": "{name}: yalnızca ilk {limit} rutin içe aktarıldı.",
  "error.import.routineInvalid": '{name}: adı, metni veya zamanlaması geçersiz olduğu için "{routine}" rutini atlandı.',
  "error.import.memoriesSkipped": "{name}: boş veya {limit} karakterden uzun olduğu için {skipped} bellek atlandı.",
  "error.import.memoryLimit": "{name}: yalnızca ilk {limit} bellek içe aktarıldı.",
  "error.import.manifestMissing": "Dışa aktarım {manifest} içermelidir.",
  "error.import.skillFolderMissing": "{name}: {skill} beceri klasöründe SKILL.md yok.",
  "error.import.avatarSkipped": "{name}: 512 KB altında bir PNG, JPEG veya WebP olmadığı için avatar atlandı.",
  "error.import.exportClosed": "Dışa aktarım artık açık değil. Yeniden seçin.",
  "error.import.agentNotInExport": "Seçim, dışa aktarımda olmayan bir ajanı belirtiyor.",
  "error.import.channelNotInExport": "Seçim, dışa aktarımda olmayan bir kanalı belirtiyor.",
  "error.import.serverAgentLimit": "Bir sunucuda en fazla {limit} ajan bulunabilir.",
  "error.import.exportChanged": "Dışa aktarım denetlendikten sonra değişti. Yeniden seçin.",
  "error.import.noMembersImported": "Ajanlarının hiçbiri içe aktarılmadı.",
  "error.import.leadNotImported": "{name}: lideri içe aktarılmadı, bu yüzden lideri yok.",
  "error.import.routineSkipped": '{name}: "{routine}" rutini atlandı. {reason}',
  "error.import.fileRenamed": "{name}: {file} zaten mevcut, bu nedenle bu kopya {saved} olarak kaydedildi.",
  "error.import.fileSkipped": "{name}: {file} dosyası atlandı. {reason}",
  "error.import.chooseZip": "Bir .zip dosyası seçin.",
  "error.import.unsafeFile": "Dışa aktarım güvenli olmayan bir dosya içeriyor: {name}",
  "error.import.tooManyFiles": "Dışa aktarım en fazla {limit} dosya içermelidir.",
  "error.import.diskSpace":
    "{name}: dosyaları için {size} GB boş disk alanı gerekiyor, boş alan {free} GB. Yer açın, ardından ajanı yeniden içe aktarın.",
  "error.import.remoteExpandedTooLarge": "Dışa aktarım açıldığında 500 MB ve {limit} dosyanın altında olmalıdır.",
  "error.import.zipInvalid":
    "Seçilen dosya geçerli bir .zip değil. Grok Bot dosyayı hâlâ kaydediyorsa bekleyip yeniden seçin.",
  "error.import.entryDamaged": "Dosya, dışa aktarımda bozuk.",
  "error.import.foldersSkipped":
    ".git ve node_modules klasörlerindeki {number} dosya dışarıda bırakıldı. Bir araç bunları yeniden oluşturabilir.",
  "error.import.empty": "Dışa aktarım boş.",
  "error.import.remoteZipTooLarge":
    "Katılınan bir sunucuya içe aktarmak için dışa aktarım 100 MB altında bir .zip olmalıdır.",
  "error.import.hostBusy": "Sunucu diğer dışa aktarımları okuyor. Birkaç dakika sonra tekrar deneyin.",
  "error.import.uploadDiskSpace":
    "Dışa aktarım sunucuda {size} GB boş disk alanı gerektiriyor ve {free} GB boş. Sunucuda yer açın, ardından dışa aktarımı yeniden seçin.",
  "error.import.remoteZipTooLargeOldHost":
    "Bu sunucu en fazla 100 MB'lık bir dışa aktarım kabul ediyor. Daha büyük bir dışa aktarımı içe aktarmak için sunucudaki OpenBot'u güncelleyin.",
  "error.import.skillKept":
    '{name}: sunucu zaten "{skill}" becerisine sahip, bu yüzden ajan bu beceriyi kullanıyor. Bir yöneticiden güncellemesini isteyin.',
  "error.import.skillRenamed":
    '{name}: "{skill}" becerisinin adı başka bir becerinin adına çok benziyor, bu yüzden "{renamed}" olarak kaydedildi.',
  "error.import.transferRemoteTooLarge":
    "Katılınan bir sunucu için aktarım dosyası 100 MB'tan küçük olmalıdır. Çalışma alanı dosyalarını kapatın veya daha az ajan dışa aktarın.",
  "error.import.transferNotFile": "Bu dosya bir OpenBot aktarım dosyası değil.",
  "error.import.transferNewer":
    "Bu dosyayı OpenBot'un daha yeni bir sürümü oluşturdu. OpenBot'u güncelleyin ve tekrar deneyin.",
  "error.import.transferEmpty": "Dosyada hiç ajan ve ayar yok.",
  "error.import.transferTooLarge":
    "Bir aktarım dosyası 2 GB'tan ve 50.000 dosyadan küçük olmalıdır. Çalışma alanı dosyalarını kapatın veya daha az ajan dışa aktarın.",
  "error.import.transferAgentInvalid": "Dosyadaki {number}. ajan geçersiz, bu yüzden atlanıyor.",
  "error.import.transferSettingsInvalid": "Dosyadaki uygulama ayarları geçersiz, bu yüzden içe aktarılmıyor.",
  "error.import.transferModelMissing":
    '{name}: "{model}" modeli burada henüz kullanılamıyor, bu yüzden ajan varsayılan modeli kullanıyor. Sağlayıcısı hazır olduğunda modeli yeniden seçin.',
  "error.import.transferSettingSkipped": "{name} içe aktarılmadı. {reason}",
  "error.import.transferRoutineFlowSkipped": "İçe aktarma bir rutin akışını dışarıda bıraktı. {reason}",
  "error.import.transferCustomAgentCommand":
    '{name}: özel ajanlar bir komut çalıştırdıkları için içe aktarılmaz. "{command}" komutunu kontrol edin ve ajanı Ayarlar\'da yeniden ekleyin.',
  "error.import.transferSkillLimit":
    "{name}: bir ajan en fazla {limit} beceriye sahip olabildiği için {total} becerisinden yalnızca ilk {limit} tanesi dosyada.",
  "error.import.transferFilesGone": "Dışa aktarma sürerken {number} dosya silindi, bu yüzden dosyada değiller.",
  "error.import.transferProviderKey": "{name}: API anahtarını Ayarlar'da yeniden girin.",
  "error.import.transferAgentEnv": "{name}: {names} değerlerini Ayarlar'da yeniden girin.",
  "error.import.transferMcpValues":
    "{name}: MCP sunucusu kapalı olarak eklendi. Komutunu kontrol edin, değerlerini ve tam adresini yeniden girin, ardından MCP ayarlarında açın.",
  "error.import.transferValuesCleared":
    "{name}: bağımsız değişkenlerinden veya adresinden gizli bilgi içerebilecek değerler kaldırıldı. Bunları Ayarlar'da yeniden girin.",
  "error.import.transferSharedKept":
    "Paylaşılan klasördeki {number} dosya zaten burada, bu yüzden oldukları gibi korunuyor.",
} as const satisfies PartialTranslation<typeof source>;
