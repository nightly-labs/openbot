import { MOBILE_COMPANY_SIGN_IN_RETURN } from "@openbot/contracts/company-sign-in";

/** True for the return link of a company sign-in, which only its browser session takes. */
export function isCompanySignInReturn(path: string): boolean {
  return (
    path === MOBILE_COMPANY_SIGN_IN_RETURN ||
    path.startsWith(`${MOBILE_COMPANY_SIGN_IN_RETURN}?`) ||
    path.startsWith(`${MOBILE_COMPANY_SIGN_IN_RETURN}/`)
  );
}

/** The query of a return link, when it has the state of the sign-in that the phone started. */
export function companySignInReturnParams(url: string, clientState: string): URLSearchParams | null {
  if (!isCompanySignInReturn(url)) return null;
  const query = url.indexOf("?");
  if (query < 0) return null;
  const params = new URLSearchParams(url.slice(query + 1).split("#")[0]);
  return params.get("state") === clientState ? params : null;
}
