import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Запис у {path} — поза робочим простором агента, спільною папкою й тимчасовими папками.",
  "status.agent.contextCleared": "Контекст очищено. Тут починається новий чат.",
  "status.agent.modelSwitchedForLimit": "Ліміт використання вичерпано. Перемкнено на {model}.",
  "status.agent.modelReturnedAfterLimit": "Ліміт використання більше не діє. Знову використовується {model}.",
  "status.agent.modelSwitchedForError": "Помилка провайдера. Перемкнено на {model}.",
  "status.agent.modelReturnedAfterError": "Після помилки провайдера знову використовується {model}.",
  "status.agent.marketplaceSuggested": "Запропоновано застосунок із каталогу: {app}.",
  "status.agent.channelMemberAdded": "Агент {agent} додав {member} до каналу. Запит: {person}.",
  "status.agent.channelMemberRemoved": "Агент {agent} видалив {member} з каналу. Запит: {person}.",
  "status.agent.channelInstructionsChanged": "Агент {agent} змінив інструкції каналу. Запит: {person}.",
  "status.agent.channelRoutineCreated": "Агент {agent} створив регулярне завдання {routine}. Запит: {person}.",
  "status.agent.channelRoutineUpdated": "Агент {agent} змінив регулярне завдання {routine}. Запит: {person}.",
  "status.agent.channelRoutineDeleted": "Агент {agent} видалив регулярне завдання {routine}. Запит: {person}.",
  "status.agent.screenCaptureScreen": "Зробити знімок головного екрана й надіслати зображення моделі агента.",
  "status.agent.screenCaptureChannel":
    "Зображення з’явиться в каналі {channel}, і його побачить кожен учасник цього сервера, який читає канал.",
  "status.agent.screenCaptureDisplay": "Зробити знімок дисплея {name} і надіслати зображення моделі агента.",
  "status.agent.screenCaptureWindow": "Зробити знімок вікна {name} і надіслати зображення моделі агента.",
  "status.agent.screenCaptureRegion":
    "Зробити знімок області екрана в координатах {x}, {y} розміром {width} × {height} точок і надіслати зображення моделі агента.",
  "status.agent.screenCaptureProgress": "Запит знімка екрана…",
  "status.agent.screenCaptureReviewing": "Перегляд знімка екрана…",
  "status.agent.memoriesSearching": "Пошук у пам’яті…",
  "status.agent.memoriesSearched": {
    one: "Пошук у пам’яті: знайдено {count}",
    few: "Пошук у пам’яті: знайдено {count}",
    many: "Пошук у пам’яті: знайдено {count}",
    other: "Пошук у пам’яті: знайдено {count}",
  },
  "status.agent.memoriesUpdating": "Оновлення пам’яті…",
  "status.agent.skillUsing": "Використання навички {name}…",
  "status.agent.skillReading": "Читання навички…",
  "status.agent.memoryChanges": "Пам’ять: збережено {saved}, оновлено {updated}, забуто {forgotten}.",
  "status.agent.memoryChangesWithConflicts":
    "Пам’ять: збережено {saved}, оновлено {updated}, забуто {forgotten}, не змінено {notChanged}, бо інша гілка змінила їх раніше.",
} as const satisfies PartialTranslation<typeof source>;
