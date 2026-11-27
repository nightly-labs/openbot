import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/crm";

export const messages = {
  "error.crm.serverTooOld":
    "Deze server ondersteunt het CRM niet. Werk OpenBot bij op de computer waarop de server draait.",
  "error.crm.tooLargeToSend": "Deze CRM-pagina is te groot om naar deze client te sturen.",
  "error.crm.customerMissing": "Deze klant bestaat niet meer.",
  "error.crm.planMissing": "Dit abonnement bestaat niet meer.",
  "error.crm.paymentMissing": "Deze betaling bestaat niet meer.",
  "error.crm.tagMissing": "Deze tag bestaat niet meer.",
  "error.crm.statusMissing": "Deze status bestaat niet meer.",
  "error.crm.proposalMissing": "Dit voorstel bestaat niet meer of er is al over beslist.",
  "error.crm.tagExists": "Er bestaat al een tag met deze naam.",
  "error.crm.statusExists": "Er bestaat al een status met deze naam.",
  "error.crm.builtinStatus": "Je kunt een ingebouwde status niet hernoemen of verwijderen.",
  "error.crm.tooManyStatuses": "Het CRM heeft het maximale aantal statussen. Verwijder eerst een status.",
  "error.crm.tooManyTags": "Het CRM heeft het maximale aantal tags. Verwijder eerst een tag.",
  "error.crm.tooManyPlans": "Deze klant heeft het maximale aantal abonnementen. Verwijder eerst een abonnement.",
  "error.crm.paymentPaid": "Deze betaling is betaald. Markeer deze eerst als niet betaald.",
  "error.crm.splitTotal": "De delen moeten samen het bedrag van de betaling vormen.",
  "error.crm.planEndsBeforeStart": "Een abonnement kan niet eindigen voordat het begint.",
  "error.crm.currencyInUse": "Je kunt de valuta niet wijzigen van een klant met abonnementen of betalingen.",
  "error.crm.badCursor": "Deze pagina is niet meer geldig. Laad de lijst opnieuw.",
  "error.crm.invalidChange": "Deze wijziging is niet geldig.",
  "error.crm.agentNotAllowed":
    "Deze agent kan het CRM niet gebruiken. Een eigenaar of beheerder kan toegang geven: open de CRM-pagina, klik op Suggesties, klik op de knop met het aantal agents en zet deze agent aan.",
  "error.crm.tooManyProposals": "Er wachten te veel voorstellen op een beslissing. Wacht tot iemand erover beslist.",
  "error.crm.amountInvalid": "Schrijf het bedrag als getal, zoals 129.00.",
  "error.crm.amountDecimals": "Het bedrag heeft te veel decimalen voor {currency}.",
  "error.crm.fieldPrivate": "Dit veld is privé. Agents kunnen het niet lezen en er niet op filteren.",
  "error.crm.sourceOwned":
    "Stripe beheert deze rij. Wijzig hem in Stripe; de CRM krijgt de wijziging bij de volgende synchronisatie.",
  "error.crm.sourceConnected": "Stripe is al verbonden met deze CRM.",
  "error.crm.sourceMissing": "Deze Stripe-verbinding bestaat niet meer.",
  "error.crm.sourceSecretKey":
    "Dit is een geheime sleutel, waarmee je je Stripe-account kunt wijzigen. Maak een beperkte sleutel met alleen leestoegang.",
  "error.crm.sourceInvalidKey": "Stripe accepteert deze sleutel niet. Kopieer de beperkte sleutel opnieuw.",
  "error.crm.sourcePermission":
    "Deze sleutel kan geen klanten, facturen, abonnementen, gebeurtenissen en producten lezen. Geef hem leestoegang daartoe.",
  "error.crm.sourceRateLimited": "Stripe kreeg te veel verzoeken. Probeer het over een minuut opnieuw.",
  "error.crm.sourceNetwork": "OpenBot kan geen verbinding maken met Stripe. Controleer de internetverbinding.",
  "error.crm.sourceFailed": "Stripe stuurde een antwoord dat OpenBot niet kan lezen. Probeer het later opnieuw.",
  "error.crm.sourceKeySaveFailed": "OpenBot kan de Stripe-sleutel niet op deze computer opslaan.",
  "error.crm.off":
    "Het CRM staat uit. Een eigenaar of beheerder kan het aanzetten in Serverinstellingen > Experimenteel.",
  "error.crm.settingsSaveFailed": "OpenBot kan de CRM-instelling op deze server niet opslaan.",
} as const satisfies PartialTranslation<typeof source>;
