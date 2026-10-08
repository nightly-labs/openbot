import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  "error.site.absolutePath": "Elige una ruta absoluta al directorio del sitio.",
  "error.site.rootSymlink": "No se permiten enlaces simbólicos en los sitios alojados.",
  "error.site.notDirectory": "El origen del sitio debe ser un directorio.",
  "error.site.outsideWorkspace":
    "El sitio debe estar dentro del espacio de trabajo de este agente o de OpenBot Shared.",
  "error.site.packageJsonInvalid": "El package.json del sitio no es válido.",
  "error.site.astroServerOutput": "Astro debe usar salida estática.",
  "error.site.astroAdapter": "No se permiten adaptadores de servidor de Astro ni la integración con React.",
  "error.site.astroApiRoutes": "No se permiten rutas API ni acciones de servidor de Astro.",
  "error.site.astroMiddleware": "No se permiten middleware ni código fuente de servidor de Astro.",
  "error.site.astroNotBuilt": "Compila el proyecto Astro primero. Se requiere que exista su directorio dist/.",
  "error.site.astroDistNotDirectory": "El directorio dist/ de Astro debe ser un directorio real.",
  "error.site.astroDistOutside": "El directorio dist/ de Astro debe permanecer dentro del directorio del proyecto.",
  "error.site.directoryOutsideRoot": "Los directorios del sitio deben permanecer dentro de la raíz del código fuente.",
  "error.site.siteTooLarge": "El sitio supera el límite de 2 MB.",
  "error.site.missingIndex": "La raíz del sitio debe contener index.html.",
  "error.site.symlink": "No se permiten enlaces simbólicos: {name}",
  "error.site.unsupportedEntry": "Elemento del sitio no admitido: {name}",
  "error.site.tooManyFiles": "Un sitio puede contener un máximo de {limit} archivos.",
  "error.site.hiddenFile": "No se permiten archivos ocultos: {path}",
  "error.site.unsafePath": "No se permite esta ruta de archivo: {path}",
  "error.site.secretFile": "No se permiten credenciales, claves privadas ni código fuente de servidor: {path}",
  "error.site.fileType": "No se permite este tipo de archivo: {path}",
  "error.site.fileOutsideRoot": "Los archivos del sitio deben permanecer dentro de la raíz del código fuente: {path}",
  "error.site.fileTooLarge": "Un archivo supera el límite de 1 MB: {path}",
} as const satisfies PartialTranslation<typeof source>;
