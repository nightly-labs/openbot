import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Запись в {path} — за пределами рабочего пространства агента, общей папки и временных папок.",
  "status.agent.contextCleared": "Контекст очищен. Здесь начинается новый чат.",
  "status.agent.modelSwitchedForLimit": "Лимит использования исчерпан. Переключено на {model}.",
  "status.agent.modelReturnedAfterLimit": "Лимит использования обновился. Снова используется {model}.",
  "status.agent.modelSwitchedForError": "Ошибка провайдера. Переключено на {model}.",
  "status.agent.modelReturnedAfterError": "После ошибки провайдера снова используется {model}.",
  "status.agent.marketplaceSuggested": "Предложено приложение из каталога: {app}.",
  "status.agent.channelMemberAdded": "Агент {agent} добавил {member} в канал. Запрос: {person}.",
  "status.agent.channelMemberRemoved": "Агент {agent} удалил {member} из канала. Запрос: {person}.",
  "status.agent.channelInstructionsChanged": "Агент {agent} изменил инструкции канала. Запрос: {person}.",
  "status.agent.channelRoutineCreated": "Агент {agent} создал регулярную задачу {routine}. Запрос: {person}.",
  "status.agent.channelRoutineUpdated": "Агент {agent} изменил регулярную задачу {routine}. Запрос: {person}.",
  "status.agent.channelRoutineDeleted": "Агент {agent} удалил регулярную задачу {routine}. Запрос: {person}.",
  "status.agent.screenCaptureScreen": "Сделать снимок главного экрана и отправить изображение модели агента.",
  "status.agent.screenCaptureChannel":
    "Изображение появится в канале {channel}, и его увидит каждый участник этого сервера, который читает канал.",
  "status.agent.screenCaptureDisplay": "Сделать снимок дисплея {name} и отправить изображение модели агента.",
  "status.agent.screenCaptureWindow": "Сделать снимок окна {name} и отправить изображение модели агента.",
  "status.agent.screenCaptureRegion":
    "Сделать снимок области экрана {x}, {y}, {width} × {height} точек и отправить изображение модели агента.",
  "status.agent.screenCaptureProgress": "Запрос снимка экрана…",
  "status.agent.screenCaptureReviewing": "Просмотр снимка экрана…",
  "status.agent.browserOpening": "Открытие веб-страницы…",
  "status.agent.browserReading": "Чтение веб-страницы…",
  "status.agent.browserClicking": "Нажатие на веб-странице…",
  "status.agent.browserTyping": "Ввод на веб-странице…",
  "status.agent.browserActing": "Работа с веб-страницей…",
  "status.agent.browserReviewing": "Просмотр веб-страницы…",
  "status.agent.memoriesSearching": "Поиск в памяти…",
  "status.agent.memoriesSearched": {
    one: "Поиск в памяти: найдено {count}",
    few: "Поиск в памяти: найдено {count}",
    many: "Поиск в памяти: найдено {count}",
    other: "Поиск в памяти: найдено {count}",
  },
  "status.agent.memoriesUpdating": "Обновление памяти…",
  "status.agent.skillUsing": "Использование навыка {name}…",
  "status.agent.skillReading": "Чтение навыка…",
  "status.agent.memoryChanges": "Память: сохранено {saved}, обновлено {updated}, забыто {forgotten}.",
  "status.agent.memoryChangesWithConflicts":
    "Память: сохранено {saved}, обновлено {updated}, забыто {forgotten}, не изменено {notChanged}, потому что другая ветка изменила их раньше.",
  "status.agent.planContinues": "В плане есть незавершённые шаги. Агент продолжает ({current} из {limit}).",
} as const satisfies PartialTranslation<typeof source>;
