import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  "error.site.absolutePath": "Escolha um caminho absoluto para o diretório do site.",
  "error.site.rootSymlink": "Links simbólicos não são permitidos em sites hospedados.",
  "error.site.notDirectory": "A origem do site deve ser um diretório.",
  "error.site.outsideWorkspace": "O site deve estar dentro do espaço de trabalho deste agente ou do OpenBot Shared.",
  "error.site.packageJsonInvalid": "O package.json do site é inválido.",
  "error.site.astroServerOutput": "O Astro deve usar saída estática.",
  "error.site.astroAdapter": "Adaptadores de servidor do Astro e integração com React não são permitidos.",
  "error.site.astroApiRoutes": "Rotas de API do Astro e ações de servidor não são permitidas.",
  "error.site.astroMiddleware": "Middleware do Astro e código-fonte do servidor não são permitidos.",
  "error.site.astroNotBuilt": "Compile o projeto Astro primeiro. É necessário que o diretório dist/ já exista.",
  "error.site.astroDistNotDirectory": "O dist/ do Astro deve ser um diretório real.",
  "error.site.astroDistOutside": "O dist/ do Astro deve permanecer dentro do diretório do projeto.",
  "error.site.directoryOutsideRoot": "Os diretórios do site devem permanecer dentro da raiz de origem.",
  "error.site.siteTooLarge": "O site excede o limite de 2 MB.",
  "error.site.missingIndex": "A raiz do site deve conter index.html.",
  "error.site.symlink": "Links simbólicos não são permitidos: {name}",
  "error.site.unsupportedEntry": "Item do site incompatível: {name}",
  "error.site.tooManyFiles": "Um site pode conter no máximo {limit} arquivos.",
  "error.site.hiddenFile": "Arquivos ocultos não são permitidos: {path}",
  "error.site.unsafePath": "Este caminho de arquivo não é permitido: {path}",
  "error.site.secretFile": "Credenciais, chaves privadas e código-fonte do servidor não são permitidos: {path}",
  "error.site.fileType": "Este tipo de arquivo não é permitido: {path}",
  "error.site.fileOutsideRoot": "Os arquivos do site devem permanecer dentro da raiz de origem: {path}",
  "error.site.fileTooLarge": "Um arquivo excede o limite de 1 MB: {path}",
} as const satisfies PartialTranslation<typeof source>;
