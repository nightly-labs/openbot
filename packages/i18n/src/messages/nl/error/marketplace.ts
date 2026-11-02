import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.timezoneInvalid": "De lokale tijdzone is ongeldig.",
  "error.marketplace.installedAgentMissing": "De geïnstalleerde agent bestaat niet meer.",
  "error.marketplace.differentListing": "Deze lokale agent is geïnstalleerd vanuit een andere agent op de marktplaats.",
  "error.marketplace.marketplaceAvatarInvalid": "De avatar van de agent op de marktplaats is ongeldig.",
  "error.marketplace.shareCardInvalid": "De deelkaart is ongeldig.",
  "error.marketplace.cannotPublish": "Deze agent kan niet worden gepubliceerd.",
  "error.marketplace.templateName": {
    one: "Geef deze agent een naam van 1 tot {count} teken.",
    other: "Geef deze agent een naam van 1 tot {count} tekens.",
  },
  "error.marketplace.templateRole": {
    one: "De rol is langer dan {count} teken. Maak hem korter.",
    other: "De rol is langer dan {count} tekens. Maak hem korter.",
  },
  "error.marketplace.templateNoInstructions": "Voeg instructies toe aan deze agent voordat je hem publiceert.",
  "error.marketplace.templateInstructions": {
    one: "De instructies zijn langer dan {count} teken. Maak ze korter.",
    other: "De instructies zijn langer dan {count} tekens. Maak ze korter.",
  },
  "error.marketplace.templateAvatar":
    "De avatar van deze agent is niet geldig. Kies hem opnieuw in de instellingen van de agent.",
  "error.marketplace.templateSkills": {
    one: "Een agent kan maximaal {count} vaardigheid publiceren. Verwijder er een paar.",
    other: "Een agent kan maximaal {count} vaardigheden publiceren. Verwijder er een paar.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "Een agent kan maximaal {count} lokale vaardigheid publiceren. Verwijder er een paar.",
    other: "Een agent kan maximaal {count} lokale vaardigheden publiceren. Verwijder er een paar.",
  },
  "error.marketplace.templateSkill":
    "De vaardigheid “{name}” kan niet worden gepubliceerd. Controleer de naam en de SKILL.md.",
  "error.marketplace.templateRoutines": {
    one: "Een agent kan maximaal {count} routine publiceren. Verwijder er een paar.",
    other: "Een agent kan maximaal {count} routines publiceren. Verwijder er een paar.",
  },
  "error.marketplace.templateRoutine": {
    one: "De routine “{name}” heeft een naam van maximaal {count} teken en een instructie nodig.",
    other: "De routine “{name}” heeft een naam van maximaal {count} tekens en een instructie nodig.",
  },
  "error.marketplace.templateRoutineNoName": "zonder naam",
  "error.marketplace.templateTooLarge":
    "Deze agent is te groot om te publiceren. Maak de instructies, vaardigheden of routines korter.",
  "error.marketplace.linkInvalid": "De link naar de agent is ongeldig.",
  "error.marketplace.changedSinceOpened":
    "Deze agent is gewijzigd nadat je hem hebt geopend. Open de link opnieuw om de nieuwe versie te bekijken.",
  "error.marketplace.skillNameConflict":
    "Je hebt al een andere lokale vaardigheid met de naam “{name}”. Wijzig de naam of verwijder deze, en voeg deze agent opnieuw toe.",
  "error.marketplace.avatarInvalid": "De avatar van de agent is ongeldig.",
  "error.marketplace.secretInName": "Verwijder het geheim of e-mailadres uit de naam voordat je publiceert.",
  "error.marketplace.secretInTitle": "Verwijder het geheim of e-mailadres uit de titel voordat je publiceert.",
  "error.marketplace.secretInInstructions":
    "Verwijder het geheim of e-mailadres uit de instructies voordat je publiceert.",
  "error.marketplace.secretInRoutine":
    "Verwijder het geheim of e-mailadres uit de routine “{name}” voordat je publiceert.",
  "error.marketplace.secretInSkill":
    "Verwijder het geheim of e-mailadres uit de vaardigheid “{name}” voordat je publiceert.",
  "error.marketplace.catalogLoadFailed": "De marktplaats kon niet worden geladen. Probeer het opnieuw.",
  "error.marketplace.templateUnreadable":
    "Deze gedeelde agent kon niet worden gelezen. De eigenaar heeft hem misschien verwijderd.",
} as const satisfies PartialTranslation<typeof source>;
