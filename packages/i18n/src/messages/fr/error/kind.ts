import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "Connexion impossible. Vérifiez votre connexion, puis réessayez.",
  "error.kind.timeout": "La requête a pris trop de temps. Vérifiez si l’action a abouti avant de réessayer.",
  "error.kind.storage":
    "L’espace de stockage est insuffisant. Libérez de l’espace sur l’ordinateur qui exécute OpenBot, puis réessayez.",
  "error.kind.filePermission":
    "OpenBot n’a pas l’autorisation d’effectuer cette action. Vérifiez les autorisations du fichier ou du dossier, puis réessayez.",
  "error.kind.notFound":
    "Un fichier ou un dossier nécessaire est introuvable. Restaurez-le ou choisissez-en un autre, puis réessayez.",
  "error.kind.readOnly":
    "Ce dossier est en lecture seule. Choisissez un dossier dans lequel vous pouvez écrire, puis réessayez.",
  "error.kind.conflict": "Un élément portant ce nom existe déjà. Choisissez un autre nom, puis réessayez.",
  "error.kind.auth": "L’authentification a échoué. Vérifiez votre compte ou la connexion au serveur, puis réessayez.",
  "error.kind.permission": "Vous n’avez pas l’autorisation d’effectuer cette action. Demandez l’accès au propriétaire.",
  "error.kind.rateLimit": "Trop de requêtes. Patientez un instant, puis réessayez.",
  "error.kind.service": "Le service est indisponible. Patientez un instant, puis réessayez.",
} as const satisfies PartialTranslation<typeof source>;
