import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest} no es JSON válido.",
  "error.import.notAgentExport": "{manifest} no es una exportación de agentes de OpenBot.",
  "error.import.newerExportSkill":
    "Esta exportación se creó con una habilidad de exportación más reciente. Actualiza OpenBot e inténtalo de nuevo.",
  "error.import.noAgents": "La exportación no contiene agentes.",
  "error.import.tooManyAgents": "La exportación contiene más de {limit} agentes.",
  "error.import.tooManyChannels": "La exportación contiene más de {limit} canales.",
  "error.import.channelSkipped": "{name}: se omite el canal porque ninguno de sus agentes está en la exportación.",
  "error.import.membersLeftOut": "{name}: se excluyen los miembros que no son agentes de esta exportación.",
  "error.import.leadNotMember": "{name}: el coordinador no es miembro, por lo que el canal queda sin coordinador.",
  "error.import.routineLimit": "{name}: solo se importan las primeras {limit} rutinas.",
  "error.import.routineInvalid":
    "{name}: se omite la rutina «{routine}» porque su nombre, texto o programación no es válido.",
  "error.import.memoriesSkipped":
    "{name}: se omiten {skipped} recuerdos porque están vacíos o superan los {limit} caracteres.",
  "error.import.memoryLimit": "{name}: solo se importan los primeros {limit} recuerdos.",
  "error.import.manifestMissing": "La exportación debe contener {manifest}.",
  "error.import.skillFolderMissing": "{name}: la carpeta de habilidades {skill} no tiene SKILL.md.",
  "error.import.avatarSkipped": "{name}: se omite el avatar porque no es un PNG, JPEG o WebP de menos de 512 KB.",
  "error.import.exportClosed": "La exportación ya no está abierta. Selecciónala de nuevo.",
  "error.import.agentNotInExport": "La selección incluye un agente que no está en la exportación.",
  "error.import.channelNotInExport": "La selección incluye un canal que no está en la exportación.",
  "error.import.serverAgentLimit": "Un servidor puede tener un máximo de {limit} agentes.",
  "error.import.exportChanged": "La exportación cambió después de comprobarla. Selecciónala de nuevo.",
  "error.import.noMembersImported": "No se importó ninguno de sus agentes.",
  "error.import.leadNotImported": "{name}: no se importó su coordinador, por lo que queda sin coordinador.",
  "error.import.routineSkipped": "{name}: se omite la rutina «{routine}». {reason}",
  "error.import.fileRenamed": "{name}: {file} ya existe, por lo que esta copia se guarda como {saved}.",
  "error.import.fileSkipped": "{name}: se omite el archivo {file}. {reason}",
  "error.import.chooseZip": "Elige un archivo .zip.",
  "error.import.unsafeFile": "La exportación contiene un archivo no seguro: {name}",
  "error.import.tooManyFiles": "La exportación debe tener {limit} archivos o menos.",
  "error.import.diskSpace":
    "{name}: sus archivos necesitan {size} GB de espacio libre en disco y hay {free} GB libres. Libera espacio y vuelve a importar el agente.",
  "error.import.remoteExpandedTooLarge":
    "La exportación descomprimida debe ocupar menos de 500 MB y contener menos de {limit} archivos.",
  "error.import.zipInvalid":
    "El archivo seleccionado no es un .zip válido. Si Grok Bot aún lo está guardando, espera y selecciónalo de nuevo.",
  "error.import.entryDamaged": "El archivo está dañado en la exportación.",
  "error.import.foldersSkipped":
    "Se omiten {number} archivos de las carpetas .git y node_modules. Una herramienta puede volver a crearlos.",
  "error.import.empty": "La exportación está vacía.",
  "error.import.remoteZipTooLarge":
    "Para importar a un servidor al que te has unido, la exportación debe ser un archivo .zip de menos de 100 MB.",
  "error.import.hostBusy": "El servidor está leyendo otras exportaciones. Inténtalo de nuevo en unos minutos.",
  "error.import.skillKept":
    "{name}: el servidor ya tiene la habilidad «{skill}», por lo que el agente usa esa habilidad. Pide a un administrador que la actualice.",
  "error.import.transferRemoteTooLarge":
    "Un archivo de transferencia para un servidor al que te uniste debe ocupar menos de 100 MB. Desactiva los archivos del espacio de trabajo o exporta menos agentes.",
  "error.import.transferNotFile": "Este archivo no es un archivo de transferencia de OpenBot.",
  "error.import.transferNewer":
    "Una versión más reciente de OpenBot creó este archivo. Actualiza OpenBot y vuelve a intentarlo.",
  "error.import.transferEmpty": "El archivo no contiene agentes ni ajustes.",
  "error.import.transferTooLarge":
    "Un archivo de transferencia debe ocupar menos de 2 GB y tener menos de 50.000 archivos. Desactiva los archivos del espacio de trabajo o exporta menos agentes.",
  "error.import.transferAgentInvalid": "El agente {number} del archivo no es válido, así que se omite.",
  "error.import.transferSettingsInvalid": "Los ajustes de la app del archivo no son válidos, así que no se importan.",
  "error.import.transferModelMissing":
    "{name}: el modelo «{model}» aún no está disponible aquí, así que el agente usa el modelo predeterminado. Vuelve a elegir el modelo cuando su proveedor esté listo.",
  "error.import.transferSettingSkipped": "{name} no se importa. {reason}",
  "error.import.transferRoutineFlowSkipped": "La importación omitió un flujo de rutina. {reason}",
  "error.import.transferCustomAgentCommand":
    "{name}: los agentes personalizados no se importan porque ejecutan un comando. Revisa el comando «{command}» y vuelve a añadir el agente en Ajustes.",
  "error.import.transferSkillLimit":
    "{name}: solo las primeras {limit} de sus {total} habilidades están en el archivo, porque un agente puede tener {limit} habilidades.",
  "error.import.transferFilesGone":
    "{number} archivos se eliminaron mientras se ejecutaba la exportación, así que no están en el archivo.",
  "error.import.transferProviderKey": "{name}: vuelve a introducir su clave de API en Ajustes.",
  "error.import.transferAgentEnv": "{name}: vuelve a introducir los valores de {names} en Ajustes.",
  "error.import.transferMcpValues":
    "{name}: el servidor MCP se añade desactivado. Revisa su comando, vuelve a introducir sus valores y su dirección completa, y actívalo en los ajustes de MCP.",
  "error.import.transferValuesCleared":
    "{name}: se quitaron de sus argumentos o de su dirección los valores que pueden contener un secreto. Vuelve a introducirlos en Ajustes.",
  "error.import.transferSharedKept":
    "{number} archivos de la carpeta compartida ya están aquí, así que se conservan tal como están.",
} as const satisfies PartialTranslation<typeof source>;
