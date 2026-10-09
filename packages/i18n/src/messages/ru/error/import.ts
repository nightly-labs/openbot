import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest} — некорректный JSON.",
  "error.import.notAgentExport": "{manifest} — не экспорт агента OpenBot.",
  "error.import.newerExportSkill":
    "Этот экспорт создан более новым навыком экспорта. Обновите OpenBot и повторите попытку.",
  "error.import.noAgents": "В экспорте нет агентов.",
  "error.import.tooManyAgents": "В экспорте больше {limit} агентов.",
  "error.import.tooManyChannels": "В экспорте больше {limit} каналов.",
  "error.import.channelSkipped": "{name}: канал пропущен, потому что ни одного из его агентов нет в экспорте.",
  "error.import.membersLeftOut": "{name}: участники, которые не являются агентами этого экспорта, пропущены.",
  "error.import.leadNotMember": "{name}: ведущий не входит в участников, поэтому у канала нет ведущего.",
  "error.import.routineLimit": "{name}: импортированы только первые {limit} регулярных задач.",
  "error.import.routineInvalid":
    "{name}: регулярная задача «{routine}» пропущена, потому что её имя, текст или расписание некорректны.",
  "error.import.memoriesSkipped":
    "{name}: записей памяти пропущено — {skipped}, потому что они пусты или длиннее {limit} символов.",
  "error.import.memoryLimit": "{name}: импортированы только первые {limit} записей памяти.",
  "error.import.manifestMissing": "Экспорт должен содержать {manifest}.",
  "error.import.skillFolderMissing": "{name}: в папке навыка {skill} нет SKILL.md.",
  "error.import.avatarSkipped": "{name}: аватар пропущен, потому что это не PNG, JPEG или WebP размером до 512 КБ.",
  "error.import.exportClosed": "Экспорт больше не открыт. Выберите его снова.",
  "error.import.agentNotInExport": "В выборе указан агент, которого нет в экспорте.",
  "error.import.channelNotInExport": "В выборе указан канал, которого нет в экспорте.",
  "error.import.serverAgentLimit": "На одном сервере может быть не более {limit} агентов.",
  "error.import.exportChanged": "Экспорт изменился после проверки. Выберите его снова.",
  "error.import.noMembersImported": "Ни один из его агентов не импортирован.",
  "error.import.leadNotImported": "{name}: его ведущий не импортирован, поэтому ведущего нет.",
  "error.import.routineSkipped": "{name}: регулярная задача «{routine}» пропущена. {reason}",
  "error.import.fileRenamed": "{name}: {file} уже существует, поэтому эта копия сохранена как {saved}.",
  "error.import.fileSkipped": "{name}: файл {file} пропущен. {reason}",
  "error.import.chooseZip": "Выберите файл .zip.",
  "error.import.zipTooLarge": "Экспорт должен быть файлом .zip размером до 500 МБ.",
  "error.import.unsafeFile": "В экспорте есть небезопасный файл: {name}",
  "error.import.expandedTooLarge":
    "После распаковки экспорт должен занимать менее 500 МБ и содержать не более {limit} файлов.",
  "error.import.zipInvalid":
    "Выбранный файл — некорректный .zip. Если Grok Bot ещё сохраняет его, подождите и выберите файл снова.",
  "error.import.empty": "Экспорт пуст.",
  "error.import.remoteZipTooLarge":
    "Чтобы импортировать на подключённый сервер, экспорт должен быть файлом .zip размером до 100 МБ.",
  "error.import.hostBusy": "Сервер читает другие экспорты. Повторите через несколько минут.",
  "error.import.skillKept":
    "{name}: на сервере уже есть навык «{skill}», поэтому агент использует его. Попросите администратора обновить его.",
} as const satisfies PartialTranslation<typeof source>;
