import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
	"dialog.confirm.ok": "Гаразд",
	"dialog.confirm.cancel": "Скасувати",
	"dialog.delete.title": "Видалити?",
	"dialog.delete.confirm": "Видалити",
	"dialog.delete.cancel": "Скасувати",
	"dialog.unsavedChanges.title": "Незбережені зміни",
	"dialog.unsavedChanges.message": "У вас є незбережені зміни. Бажаєте зберегти їх перед виходом?",
	"dialog.unsavedChanges.save": "Зберегти",
	"dialog.unsavedChanges.discard": "Не зберігати",
	"dialog.error.title": "Помилка",
	"dialog.error.ok": "Зрозуміло",
	"dialog.chooseSiteDirectory": "Choose a static site directory",
	"dialog.chooseAgentFolder": "Choose a folder for {agent}",
	"dialog.chooseChannelFolder": "Choose a folder for {channel}",
	"dialog.chooseAgentExclusion": "Choose a folder that {agent} must not change",
	"dialog.chooseSkill": "Choose a skill folder or ZIP",
	"dialog.filter.skillPackages": "Skill packages",
	"dialog.filter.images": "Images",
	"dialog.filter.supportedFiles": "Supported files",
	"dialog.filter.attachment": "Attachment",
	"dialog.filter.zipArchive": "ZIP archive",
	"dialog.filter.jsonDocument": "JSON document",
	"dialog.chooseAgentExport": "Choose an agent export",
	"dialog.chooseHermesFolder": "Choose the Hermes folder",
	"dialog.filter.agentExports": "Agent exports",
	"dialog.chooseVaultCsv": "Choose a password export",
	"dialog.filter.csv": "CSV files",
	"dialog.saveExportSkill": "Save the export skill",
	"dialog.saveTransfer": "Save the transfer file",
	"dialog.chooseTransfer": "Choose a transfer file",
	"dialog.filter.transfer": "OpenBot transfer files",
	"dialog.chooseExternalLinkApp": "Choose a browser",
	"dialog.filter.applications": "Applications",
};


 as const satisfies PartialTranslation<typeof source>;
