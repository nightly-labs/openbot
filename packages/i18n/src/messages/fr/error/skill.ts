import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/skill";

export const messages = {
  // Skill package, library, and marketplace errors.
  "error.skill.symlinks": "Les paquets de compétences ne peuvent pas contenir de liens symboliques.",
  "error.skill.expandedTooLarge": "La compétence décompressée doit faire moins de 10 Mo.",
  "error.skill.irregularEntry":
    "Les paquets de compétences ne peuvent contenir que des fichiers et des dossiers ordinaires.",
  "error.skill.packageTooLarge": "Le paquet de compétence doit faire moins de 10 Mo.",
  "error.skill.missingSkillFile": "Le paquet de compétence doit contenir SKILL.md à sa racine.",
  "error.skill.frontmatterMissing": "SKILL.md doit commencer par un en-tête YAML.",
  "error.skill.metadataInvalid": "Les métadonnées de SKILL.md ne sont pas valides.",
  "error.skill.nameAndDescriptionRequired": "SKILL.md doit avoir un nom et une description valides.",
  "error.skill.zipInvalid": "Le fichier ZIP choisi n’est pas valide.",
  "error.skill.fileCountInvalid": "Le paquet de compétence a un nombre de fichiers non valide.",
  "error.skill.slugInvalid": "Le nom de la compétence ne permet pas de former un identifiant valide.",
  "error.skill.tooManyFiles": "Une compétence peut contenir au maximum {limit} fichiers.",
  "error.skill.unsafeFile": "Le paquet de compétence contient un fichier non sûr : {name}",
  "error.skill.markdownTooLarge": "SKILL.md dépasse 256 Ko.",
  "error.skill.markdownUnreadable": "Impossible de lire SKILL.md.",
  "error.skill.frontmatterInvalid": "L’en-tête de SKILL.md n’est pas du YAML valide.",
  "error.skill.descriptionLength": "SKILL.md doit avoir une description de 1 à {limit} caractères.",
  "error.skill.nameMismatch": "SKILL.md doit contenir « name: {slug} », comme le nom de son dossier.",
  "error.skill.draftExpired": "Le paquet de compétence choisi a expiré. Choisissez-le de nouveau.",
  "error.skill.localHasNoVersion": "Une compétence locale n’a pas de version publiée.",
  "error.skill.publishLocalFirst": "Publiez les compétences locales séparément avant de publier cet agent.",
  "error.skill.bundleMismatch": "La compétence téléchargée ne correspond pas à son entrée signée du catalogue.",
  "error.skill.metadataMismatch": "Les métadonnées de la compétence téléchargée ne correspondent pas au catalogue.",
  "error.skill.folderTaken": "Une autre compétence installée utilise ce nom de dossier.",
  "error.skill.replaceModified":
    "Cette compétence a des modifications locales. Confirmez le remplacement pour continuer.",
  "error.skill.removeModified":
    "Cette compétence a des modifications locales. Confirmez la suppression pour les effacer.",
  "error.skill.notFound": "Compétence introuvable.",
  "error.skill.disableModified":
    "Cette compétence a des modifications locales. Enregistrez ou harmonisez les deux copies des fournisseurs avant de la désactiver.",
  "error.skill.disableNeedsRepair": "Cette compétence doit être réparée avant de pouvoir être désactivée.",
  "error.skill.enableNeedsRepair": "Cette compétence doit être réparée avant de pouvoir être activée.",
  "error.skill.providerFolderOccupied":
    "Le dossier de fournisseur de cette compétence est occupé. Déplacez ou harmonisez ses fichiers avant de l’activer.",
  "error.skill.chooseLocalAgent": "Choisissez d’abord un agent local.",
  "error.skill.localLibraryUnavailable": "La bibliothèque de compétences locales n’est pas disponible.",
  "error.skill.lockInvalid": "L’enregistrement de la compétence installée n’est pas valide. Il n’a pas été modifié.",
  "error.skill.installPathSymlink":
    "Les chemins d’installation des compétences ne peuvent pas contenir de liens symboliques.",
  "error.skill.duplicateSlug": "Deux compétences s’appellent « {slug} ». Renommez l’une d’elles avant la publication.",
  "error.skill.publishNeedsRepair": "{name} a des modifications locales ou doit être réparée avant la publication.",
  "error.skill.publishUntracked":
    "{name} a été installée avant le suivi exact des versions. Mettez-la à jour ou réparez-la avant la publication.",
  "error.skill.tooManySkills": "Un agent peut avoir jusqu’à {limit} compétences.",
  "error.skill.unmanagedExists": "Une compétence non gérée existe déjà à l’emplacement {path}.",
  "error.skill.templateMarkdownTooLarge": "{name} : SKILL.md dépasse 64 Ko. Raccourcissez-le avant la publication.",
  "error.skill.localNoRevisions": "La compétence locale n’a aucune révision publiée.",
  "error.skill.localNameTaken": "Une compétence locale porte déjà ce nom. Révisez-la plutôt.",
  "error.skill.localKeepName": "Gardez le même nom de compétence lors de sa révision.",
  "error.skill.localRelativeFolder":
    "Utilisez un dossier de compétence relatif dans l’espace de travail de l’agent actuel.",
  "error.skill.localSourceOutside": "La source de la compétence doit se trouver dans l’espace de travail de l’agent.",
  "error.skill.localSourceNotFolder": "La source de la compétence doit être un dossier.",
  "error.skill.localMissingSkillFile": "Le dossier de la compétence doit contenir SKILL.md à sa racine.",
  "error.skill.pathSymlink": "Les chemins des compétences ne peuvent pas contenir de liens symboliques.",
  "error.skill.folderNotRead": "{provider} ne lit pas {folder}. Copiez ce dossier dans {target}.",
} as const satisfies PartialTranslation<typeof source>;
