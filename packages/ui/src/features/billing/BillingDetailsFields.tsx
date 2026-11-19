import {
  BILLING_COUNTRIES,
  type BillingDetails,
  type BillingDetailsRequest,
  isEuVatCountry,
  normalizeVatId,
  vatIdPrefix,
} from "@openbot/contracts/billing-details";
import { Field, Input, Label, SearchSelect } from "@openbot/ui";
import { createMemo, createSignal, createUniqueId, Show } from "solid-js";
import { useText } from "../../text";

/** The billing details calls of one surface: desktop IPC or the web client's account server requests. */
export interface BillingDetailsCalls {
  getDetails: () => Promise<BillingDetails>;
  /** The account server checks a VAT ID of another EU country with the EU VIES before it saves it. */
  setDetails: (request: BillingDetailsRequest) => Promise<BillingDetails>;
}

/** The form value: the country, and the VAT ID as the buyer types it. */
export interface BillingDetailsDraft {
  country: string | null;
  vatId: string;
}

/** The saved country comes first; with none saved, the account server's guess from the IP address. */
export function billingDetailsDraft(details: BillingDetails | null): BillingDetailsDraft {
  return { country: details?.country ?? details?.suggestedCountry ?? null, vatId: details?.vatId ?? "" };
}

/**
 * The request of a complete draft. Null while there is no country, or while the VAT ID is not one of the
 * country. The VAT ID is only for a country in the EU: for another country it is ignored.
 */
export function billingDetailsRequest(draft: BillingDetailsDraft): BillingDetailsRequest | null {
  if (!draft.country) return null;
  if (!isEuVatCountry(draft.country) || draft.vatId.trim() === "") return { country: draft.country };
  const vatId = normalizeVatId(draft.country, draft.vatId);
  return vatId ? { country: draft.country, vatId } : null;
}

/**
 * Saves the draft before Checkout opens, only when it differs from the saved details: each save of a VAT ID
 * asks the EU VIES again. Returns the saved details.
 */
export async function saveBillingDetails(
  calls: BillingDetailsCalls,
  saved: BillingDetails | null,
  draft: BillingDetailsDraft,
): Promise<BillingDetails | null> {
  const request = billingDetailsRequest(draft);
  if (!request) return saved;
  if (saved && saved.country === request.country && saved.vatId === (request.vatId ?? null)) return saved;
  return calls.setDetails(request);
}

/**
 * The billing country, which every order needs, and the EU VAT ID of a company in the EU. They decide the
 * VAT of the order, so they come before the payment page.
 */
export function BillingDetailsFields(props: {
  value: BillingDetailsDraft;
  onChange: (value: BillingDetailsDraft) => void;
  disabled?: boolean | undefined;
}) {
  const { t, locale } = useText();
  const countryLabel = `billing-details-country-${createUniqueId()}`;
  const countryValue = `${countryLabel}-value`;
  let root: HTMLDivElement | undefined;
  // In a dialog, such as the license purchase, the list opens in the dialog. On the body it would open under the
  // dialog overlay, and a click could not reach a country.
  const listMount = () => root?.closest("[role=dialog],[role=alertdialog]") ?? undefined;
  const regionNames = createMemo(() => new Intl.DisplayNames([locale()], { type: "region" }));
  const countryName = (code: string) => regionNames().of(code) ?? code;
  const countries = createMemo(() => {
    const collator = new Intl.Collator(locale());
    return [...BILLING_COUNTRIES].sort((a, b) => collator.compare(countryName(a), countryName(b)));
  });
  // The VAT ID shows its error when the buyer leaves the field, not at each key.
  const [vatIdLeft, setVatIdLeft] = createSignal(false);
  const euCountry = () => {
    const country = props.value.country;
    return country !== null && isEuVatCountry(country) ? country : null;
  };
  const vatIdError = () => {
    const country = euCountry();
    if (!country || !vatIdLeft() || props.value.vatId.trim() === "") return undefined;
    return normalizeVatId(country, props.value.vatId) ? undefined : t("billing.details.vatIdInvalid");
  };

  return (
    <div ref={root} class="billing-details-fields">
      <div class="ui-field">
        <Label id={countryLabel}>{t("billing.details.country")}</Label>
        <SearchSelect<string>
          options={countries()}
          value={props.value.country}
          label={countryName}
          disabled={props.disabled}
          mount={listMount()}
          aria-labelledby={`${countryLabel} ${countryValue}`}
          onChange={(country) => props.onChange({ ...props.value, country })}
        >
          <span
            id={countryValue}
            class="ui-select-value billing-details-country"
            data-empty={props.value.country === null ? "" : undefined}
          >
            {props.value.country === null ? t("billing.details.countryPlaceholder") : countryName(props.value.country)}
          </span>
        </SearchSelect>
      </div>
      <Show when={euCountry()}>
        {(country) => (
          <Field label={t("billing.details.vatId")} error={vatIdError()}>
            <Input
              value={props.value.vatId}
              placeholder={vatIdPrefix(country())}
              autocomplete="off"
              spellcheck={false}
              disabled={props.disabled}
              onValueChange={(vatId) => {
                setVatIdLeft(false);
                props.onChange({ ...props.value, vatId });
              }}
              onBlur={() => setVatIdLeft(true)}
            />
          </Field>
        )}
      </Show>
    </div>
  );
}
