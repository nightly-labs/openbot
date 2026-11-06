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
  "error.import.zipTooLarge": "Экспорт должен быть файлом .zip размером до 2 ГБ.",
  "error.import.unsafeFile": "В экспорте есть небезопасный файл: {name}",
  "error.import.expandedTooLarge":
    "После распаковки экспорт должен занимать менее 2 ГБ и содержать не более {limit} файлов.",
  "error.import.remoteExpandedTooLarge":
    "После распаковки экспорт должен занимать менее 500 МБ и содержать не более {limit} файлов.",
  "error.import.zipInvalid":
    "Выбранный файл — некорректный .zip. Если Grok Bot ещё сохраняет его, подождите и выберите файл снова.",
  "error.import.empty": "Экспорт пуст.",
  "error.import.remoteZipTooLarge":
    "Чтобы импортировать на подключённый сервер, экспорт должен быть файлом .zip размером до 100 МБ.",
  "error.import.hostBusy": "Сервер читает другие экспорты. Повторите попытку через несколько минут.",
  "error.import.skillKept":
    "{name}: на сервере уже есть навык «{skill}», поэтому агент использует его. Попросите администратора обновить его.",
  "error.import.transferRemoteTooLarge":
    "Файл переноса для присоединённого сервера должен быть меньше 100 МБ. Выключите файлы рабочих пространств или экспортируйте меньше агентов.",
  "error.import.transferNotFile": "Это не файл переноса OpenBot.",
  "error.import.transferNewer": "Этот файл создан более новой версией OpenBot. Обновите OpenBot и повторите попытку.",
  "error.import.transferEmpty": "В файле нет ни агентов, ни настроек.",
  "error.import.transferTooLarge":
    "Файл переноса должен быть меньше 2 ГБ и содержать меньше 50 000 файлов. Выключите файлы рабочих пространств или экспортируйте меньше агентов.",
  "error.import.transferAgentInvalid": "Агент {number} в файле некорректен, поэтому он пропущен.",
  "error.import.transferSettingsInvalid": "Настройки приложения в файле некорректны, поэтому они не импортированы.",
  "error.import.transferModelMissing":
    "{name}: модель «{model}» здесь пока недоступна, поэтому агент использует модель по умолчанию. Выберите модель снова, когда её провайдер будет готов.",
  "error.import.transferSettingSkipped": "{name}: не импортировано. {reason}",
  "error.import.transferRoutineFlowSkipped": "Схема регулярной задачи не импортирована. {reason}",
  "error.import.transferCustomAgentCommand":
    "{name}: собственные агенты не импортируются, потому что они запускают команду. Проверьте команду «{command}» и снова добавьте агента в настройках.",
  "error.import.transferSkillLimit":
    "{name}: в файле только первые {limit} из {total} навыков, потому что у агента может быть не больше {limit} навыков.",
  "error.import.transferFilesGone": "Файлы ({number}) были удалены во время экспорта, поэтому их нет в файле.",
  "error.import.transferProviderKey": "{name}: снова введите API-ключ в настройках.",
  "error.import.transferAgentEnv": "{name}: снова введите значения {names} в настройках.",
  "error.import.transferMcpValues":
    "{name}: сервер MCP добавлен выключенным. Проверьте его команду, снова введите значения и полный адрес и включите его в настройках MCP.",
  "error.import.transferValuesCleared":
    "{name}: значения, которые могут содержать секрет, удалены из аргументов или адреса. Снова введите их в настройках.",
  "error.import.transferSharedKept":
    "Файлы в общей папке ({number}) уже есть здесь, поэтому они оставлены без изменений.",
} as const satisfies PartialTranslation<typeof source>;
