import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot kan geen verbinding maken. Probeer opnieuw.",
  "mobile.link.invite.signInTitle": "Log in om lid te worden van deze server",
  "mobile.link.invite.signInDescription":
    "Scan de QR-code in OpenBot op je computer. Daarna kun je de uitnodiging bekijken.",
  "mobile.link.invite.cancel": "Annuleer uitnodiging",
  "mobile.link.pairing.title": "Verbind deze telefoon",
  "mobile.link.pairing.alreadySignedIn":
    "Je bent al ingelogd. Log uit in Instellingen voordat je een ander account verbindt.",
  "mobile.link.pairing.description":
    "Ga alleen door als je deze Mobile Connect-link zelf hebt aangevraagd op je computer.",
  "mobile.link.pairing.accountService":
    "Deze link maakt verbinding met de accountservice op {origin}, niet met de accountservice van OpenBot.",
  "mobile.link.pairing.connect": "Verbinden",
  "mobile.link.plugin.title": "Open pluginpagina",
  "mobile.link.plugin.description": "Bekijk deze plug-in op de website van OpenBot.",
  "mobile.link.plugin.openFailed": "Kan de pluginpagina niet openen.",
  "mobile.link.plugin.view": "Bekijk plug-in",
  "mobile.link.unavailable.title": "Link niet beschikbaar",
  "mobile.link.unavailable.description":
    "Deze link is ongeldig, niet meer beschikbaar of wordt niet ondersteund op mobiel.",
  "mobile.link.template.signInTitle": "Log in om deze agent toe te voegen",
  "mobile.link.template.signInDescription":
    "Scan de QR-code in OpenBot op je computer. Daarna kun je de agent bekijken voordat je hem toevoegt.",
  "mobile.link.template.loading": "Agent laden…",
  "mobile.link.template.creator": "Door {name}",
  "mobile.link.template.section.instructions": "Instructies",
  "mobile.link.template.section.skills": "Vaardigheden",
  "mobile.link.template.section.noSkills": "Geen vaardigheden.",
  "mobile.link.template.section.routines": "Routines",
  "mobile.link.template.section.noRoutines": "Geen routines.",
  "mobile.link.template.skill.local": "Lokale vaardigheid (alleen SKILL.md)",
  "mobile.link.template.skill.marketplace": "Vaardigheid uit marktplaats, versie {version}",
  "mobile.link.template.server.title": "Voeg toe aan server",
  "mobile.link.template.server.footer": "Alleen servers waar je eigenaar of beheerder bent, staan hier.",
  "mobile.link.template.server.updateRequired": "Werk OpenBot bij op deze server om gedeelde agents toe te voegen.",
  "mobile.link.template.server.none":
    "Je moet eigenaar of beheerder van een server zijn om een gedeelde agent toe te voegen.",
  "mobile.link.template.install.action": "Voeg agent toe",
  "mobile.link.template.install.pending": "Toevoegen…",
  "mobile.link.template.install.failed": "Kan de agent niet toevoegen.",
  "mobile.link.template.notFound.title": "Agent niet gevonden",
  "mobile.link.template.notFound.description":
    "Deze gedeelde agent bestaat niet of de maker heeft de publicatie ingetrokken.",
  "mobile.link.template.error.title": "Kan de agent niet laden",
  "mobile.link.template.error.loadFailed": "Kan de gedeelde agent niet lezen. Probeer opnieuw.",
  "mobile.link.template.error.unsupported":
    "Deze server kan geen gedeelde agents toevoegen. Werk OpenBot bij op de computer waarop de server draait.",
} as const satisfies PartialTranslation<typeof source>;
