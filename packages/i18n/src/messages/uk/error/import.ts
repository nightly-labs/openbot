import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest} — некоректний JSON.",
  "error.import.notAgentExport": "{manifest} — не експорт агента OpenBot.",
  "error.import.newerExportSkill":
    "Цей експорт створено новішою навичкою експорту. Оновіть OpenBot і спробуйте ще раз.",
  "error.import.noAgents": "Експорт не містить агентів.",
  "error.import.tooManyAgents": "Експорт містить понад {limit} агентів.",
  "error.import.tooManyChannels": "Експорт містить понад {limit} каналів.",
  "error.import.channelSkipped": "{name}: канал пропущено, бо жодного з його агентів немає в експорті.",
  "error.import.membersLeftOut": "{name}: учасників, які не є агентами цього експорту, пропущено.",
  "error.import.leadNotMember": "{name}: ведучий не є учасником, тому канал не має ведучого.",
  "error.import.routineLimit": "{name}: імпортовано лише перші {limit} регулярних завдань.",
  "error.import.routineInvalid":
    "{name}: регулярне завдання «{routine}» пропущено, бо його назва, текст або розклад некоректні.",
  "error.import.memoriesSkipped":
    "{name}: пропущено записів пам’яті — {skipped}, бо вони порожні або довші за {limit} символів.",
  "error.import.memoryLimit": "{name}: імпортовано лише перші {limit} записів пам’яті.",
  "error.import.manifestMissing": "Експорт має містити {manifest}.",
  "error.import.skillFolderMissing": "{name}: у папці навички {skill} немає SKILL.md.",
  "error.import.avatarSkipped": "{name}: аватар пропущено, бо це не PNG, JPEG або WebP розміром менше 512 КБ.",
  "error.import.exportClosed": "Експорт більше не відкритий. Виберіть його знову.",
  "error.import.agentNotInExport": "У вибраному є агент, якого немає в експорті.",
  "error.import.channelNotInExport": "У вибраному є канал, якого немає в експорті.",
  "error.import.serverAgentLimit": "Сервер може мати не більше {limit} агентів.",
  "error.import.exportChanged": "Експорт змінився після перевірки. Виберіть його знову.",
  "error.import.noMembersImported": "Жодного з його агентів не імпортовано.",
  "error.import.leadNotImported": "{name}: його ведучого не імпортовано, тому ведучого немає.",
  "error.import.routineSkipped": "{name}: регулярне завдання «{routine}» пропущено. {reason}",
  "error.import.fileRenamed": "{name}: {file} уже існує, тому цю копію збережено як {saved}.",
  "error.import.fileSkipped": "{name}: файл {file} пропущено. {reason}",
  "error.import.chooseZip": "Виберіть файл .zip.",
  "error.import.zipTooLarge": "Експорт має бути файлом .zip розміром менше 500 МБ.",
  "error.import.unsafeFile": "Експорт містить небезпечний файл: {name}",
  "error.import.expandedTooLarge":
    "Після розпакування експорт має займати менше 500 МБ і містити менше {limit} файлів.",
  "error.import.zipInvalid":
    "Вибраний файл — некоректний .zip. Якщо Grok Bot ще зберігає його, зачекайте й виберіть файл знову.",
  "error.import.empty": "Експорт порожній.",
  "error.import.remoteZipTooLarge":
    "Щоб імпортувати на приєднаний сервер, експорт має бути файлом .zip розміром менше 100 МБ.",
  "error.import.hostBusy": "Сервер читає інші експорти. Спробуйте ще раз за кілька хвилин.",
  "error.import.skillKept":
    "{name}: сервер уже має навичку «{skill}», тому агент використовує її. Попросіть адміністратора оновити її.",
  "error.import.transferRemoteTooLarge":
    "Файл перенесення для приєднаного сервера має бути розміром менше 100 МБ. Вимкніть файли робочих просторів або експортуйте менше агентів.",
  "error.import.transferNotFile": "Це не файл перенесення OpenBot.",
  "error.import.transferNewer": "Цей файл створено новішою версією OpenBot. Оновіть OpenBot і спробуйте ще раз.",
  "error.import.transferEmpty": "Файл не містить ні агентів, ні налаштувань.",
  "error.import.transferTooLarge":
    "Файл перенесення має бути розміром менше 2 ГБ і містити менше 50 000 файлів. Вимкніть файли робочих просторів або експортуйте менше агентів.",
  "error.import.transferAgentInvalid": "Агент {number} у файлі некоректний, тому його пропущено.",
  "error.import.transferSettingsInvalid": "Налаштування застосунку у файлі некоректні, тому їх не імпортовано.",
  "error.import.transferModelMissing":
    "{name}: модель «{model}» тут поки недоступна, тому агент використовує модель за замовчуванням. Виберіть модель знову, коли її провайдер буде готовий.",
  "error.import.transferSettingSkipped": "{name}: не імпортовано. {reason}",
  "error.import.transferRoutineFlowSkipped": "Схему регулярного завдання не імпортовано. {reason}",
  "error.import.transferCustomAgentCommand":
    "{name}: власні агенти не імпортуються, бо вони запускають команду. Перевірте команду «{command}» і додайте агента знову в налаштуваннях.",
  "error.import.transferSkillLimit":
    "{name}: у файлі лише перші {limit} з {total} навичок, бо агент може мати не більше {limit} навичок.",
  "error.import.transferFilesGone": "Файли ({number}) було видалено під час експорту, тому їх немає у файлі.",
  "error.import.transferProviderKey": "{name}: знову введіть API-ключ у налаштуваннях.",
  "error.import.transferAgentEnv": "{name}: знову введіть значення {names} у налаштуваннях.",
  "error.import.transferMcpValues":
    "{name}: сервер MCP додано вимкненим. Перевірте його команду, знову введіть значення й повну адресу та увімкніть його в налаштуваннях MCP.",
  "error.import.transferValuesCleared":
    "{name}: значення, які можуть містити секрет, видалено з аргументів або адреси. Знову введіть їх у налаштуваннях.",
  "error.import.transferSharedKept": "Файли в папці Shared ({number}) уже є тут, тому їх залишено без змін.",
} as const satisfies PartialTranslation<typeof source>;
