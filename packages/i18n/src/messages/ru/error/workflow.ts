import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Этого рабочего процесса больше нет.",
  "error.workflow.versionMissing": "Этой версии рабочего процесса больше нет.",
  "error.workflow.annotation": "У текста, заметок и фигур не может быть связей.",
  "error.workflow.port": "Шаг не может принимать такой тип входных данных.",
  "error.workflow.branch": "Только у условия могут быть связи «да» и «нет».",
  "error.workflow.conditionBranch": "Каждая связь от условия должна быть «да» или «нет».",
  "error.workflow.duplicateEdge": "У этих двух шагов уже есть такая связь.",
  "error.workflow.serverTooOld":
    "Этот сервер не поддерживает рабочие процессы. Обновите OpenBot на компьютере, на котором он работает.",
  "error.workflow.nodeUnsupported":
    "Эта версия OpenBot пока не может выполнять шаги с изображениями, файлами и сообщениями.",
  "error.workflow.interrupted": "OpenBot остановился во время этого шага. Запустите его снова.",
  "error.workflow.agentMissing": "Выберите агента для этого шага.",
  "error.workflow.handoffFailed": "OpenBot не смог отправить этот шаг агенту.",
  "error.workflow.agentStepEnded": "Сообщение агенту было удалено до его ответа.",
  "error.workflow.conditionUnclear": "Модель не ответила «да» или «нет».",
  "error.workflow.modelFailed": "Модель не смогла ответить. Запустите шаг снова.",
  "error.workflow.modelBusy": "Выполняется другой запрос к модели. Скоро запустите шаг снова.",
  "error.workflow.stepMissing": "Этого шага больше нет.",
  "error.workflow.nodeMissing": "Этого шага нет в рабочем процессе.",
  "error.workflow.runMissing": "Этого запуска больше нет.",
  "error.workflow.notRetryable": "Снова можно запустить только шаг, который завершился ошибкой или был остановлен.",
  "error.workflow.noDecision": "Этот шаг не ждет решения.",
  "error.workflow.outputPlaceMissing": "Выберите место в мессенджере для этого вывода.",
  "error.workflow.outputConnectionOff":
    "Подключение мессенджера для этого вывода выключено или удалено. Выберите место снова.",
  "error.workflow.outputNotRunning": "Подключение мессенджера сейчас не работает. Повторите, когда оно заработает.",
  "error.workflow.outputRefused": "Место отклонило публикацию. Убедитесь, что OpenBot может публиковать там.",
  "error.workflow.outputUncertain":
    "Публикация остановилась на полпути. Часть её может уже быть в этом месте. Проверьте перед повтором.",
  "error.workflow.tooLarge":
    "Этот рабочий процесс слишком большой для сохранения. Удалите часть рисунков или длинных текстов и повторите попытку.",
  "error.workflow.tooLargeToSend":
    "Этот рабочий процесс слишком большой, чтобы отправить его на другой компьютер. Откройте его на компьютере, где работает сервер.",
  "error.workflow.webhookMissing":
    "Этот шаг не является триггером веб-хука. Сохраните рабочий процесс и повторите попытку.",
  "error.workflow.githubActionMissing": "Выберите, что этот вывод делает на GitHub.",
  "error.workflow.githubRepositoryMissing": "Выберите репозиторий для этого вывода.",
  "error.workflow.githubItemMissing":
    "У этого вывода нет задачи или пул-реквеста. Запустите процесс из события GitHub или укажите номер на его входе.",
  "error.workflow.githubPullRequestOnly": "Это действие работает только с пул-реквестами.",
  "error.workflow.githubTextMissing": "У этого вывода нет текста для отправки. Подключите шаг, который его пишет.",
  "error.workflow.githubChoiceMissing": "Выберите метки или человека для этого вывода.",
  "error.workflow.githubChoseNothing": "Модель не выбрала ни одной метки или человека из этого репозитория.",
  "error.workflow.githubNotConnected": "Подключите GitHub на компьютере, на котором работает этот рабочий процесс.",
  "error.workflow.githubNoAccess":
    "OpenBot GitHub App не видит этот репозиторий или элемент. Откройте GitHub и дайте приложению доступ.",
  "error.workflow.githubNoWrite":
    "OpenBot GitHub App не может изменять этот репозиторий. Откройте GitHub и дайте приложению доступ.",
  "error.workflow.githubLocked": "Это обсуждение заблокировано на GitHub.",
  "error.workflow.githubRefused": "GitHub отклонил изменение: {detail}",
  "error.workflow.githubUnreachable": "OpenBot не удалось связаться с GitHub. Запустите шаг снова.",
  "error.workflow.githubUncertain":
    "Изменение остановилось на полпути. Оно может уже быть на GitHub. Проверьте там, прежде чем запускать шаг снова.",
  "error.workflow.githubNoEvent": "На GitHub нет задачи или пул-реквеста, на которых запускается этот триггер.",
} as const satisfies PartialTranslation<typeof source>;
