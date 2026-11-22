import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
	"menu.app.about": "Про OpenBot",
	"menu.app.checkForUpdates": "Перевірити оновлення…",
	"menu.app.settings": "Налаштування…",
	"menu.app.services": "Служби",
	"menu.app.hide": "Сховати OpenBot",
	"menu.app.hideOthers": "Сховати інші",
	"menu.app.unhide": "Показати всі",
	"menu.app.quit": "Завершити OpenBot",
	"menu.file": "Файл",
	"menu.file.newChat": "Новий чат",
	"menu.file.closeWindow": "Закрити вікно",
	"menu.edit": "Правка",
	"menu.edit.undo": "Скасувати",
	"menu.edit.redo": "Повторити",
	"menu.edit.cut": "Вирізати",
	"menu.edit.copy": "Копіювати",
	"menu.edit.paste": "Вставити",
	"menu.edit.selectAll": "Вибрати все",
	"menu.view": "Вигляд",
	"menu.view.reload": "Перезавантажити",
	"menu.view.forceReload": "Примусово перезавантажити",
	"menu.view.toggleDevTools": "Інструменти розробника",
	"menu.view.resetZoom": "Скинути масштаб",
	"menu.view.zoomIn": "Збільшити",
	"menu.view.zoomOut": "Зменшити",
	"menu.view.toggleFullScreen": "Повноекранний режим",
	"menu.window": "Вікно",
	"menu.window.minimize": "Згорнути",
	"menu.window.zoom": "Збільшити вікно",
};


 as const satisfies PartialTranslation<typeof source>;
