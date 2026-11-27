export const WEB_APP_COMPANY_SIGN_IN_ERROR_PARAM = "companySignInError";

export const MOBILE_COMPANY_SIGN_IN_RETURN = "openbot://company-sign-in";

const COMPANY_SIGN_IN_ERROR_KEYS = {
  cancelled: "error.auth.companySignInCancelled",
  timeout: "error.auth.companySignInTimeout",
  company_provider_refused: "error.auth.companySignInRefused",
  company_email_domain_mismatch: "error.auth.companySignInDomainMismatch",
  company_account_disabled: "error.auth.companySignInAccountDisabled",
  company_sign_in_not_found: "error.auth.companySignInOff",
  company_email_missing: "error.auth.companySignInEmailMissing",
  company_sign_in_unavailable: "error.auth.companySignInUnavailable",
  company_provider_rejected: "error.auth.companySignInProviderRejected",
  company_token_invalid: "error.auth.companySignInTokenInvalid",
  company_provider_unreachable: "error.auth.companySignInProviderUnreachable",
  company_domain_taken: "error.auth.companySignInDomainTaken",
} as const;

type CompanySignInErrorKey =
  | (typeof COMPANY_SIGN_IN_ERROR_KEYS)[keyof typeof COMPANY_SIGN_IN_ERROR_KEYS]
  | "error.auth.companySignInFailed";

const COMPANY_SIGN_IN_ERROR_MESSAGES = new Map<string, CompanySignInErrorKey>(
  Object.entries(COMPANY_SIGN_IN_ERROR_KEYS),
);

export function companySignInErrorKey(code: string): CompanySignInErrorKey {
  return COMPANY_SIGN_IN_ERROR_MESSAGES.get(code) ?? "error.auth.companySignInFailed";
}
