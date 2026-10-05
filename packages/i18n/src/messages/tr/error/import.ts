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
  "error.import.zipTooLarge": "Dışa aktarım 500 MB altında bir .zip olmalıdır.",
  "error.import.unsafeFile": "Dışa aktarım güvenli olmayan bir dosya içeriyor: {name}",
  "error.import.expandedTooLarge": "Dışa aktarım açıldığında 500 MB ve {limit} dosyanın altında olmalıdır.",
  "error.import.zipInvalid":
    "Seçilen dosya geçerli bir .zip değil. Grok Bot dosyayı hâlâ kaydediyorsa bekleyip yeniden seçin.",
  "error.import.empty": "Dışa aktarım boş.",
  "error.import.remoteZipTooLarge":
    "Katılınan bir sunucuya içe aktarmak için dışa aktarım 100 MB altında bir .zip olmalıdır.",
  "error.import.hostBusy": "Sunucu diğer dışa aktarımları okuyor. Birkaç dakika sonra tekrar deneyin.",
  "error.import.skillKept":
    '{name}: sunucu zaten "{skill}" becerisine sahip, bu yüzden ajan bu beceriyi kullanıyor. Bir yöneticiden güncellemesini isteyin.',
} as const satisfies PartialTranslation<typeof source>;
