import { MOBILE_COMPANY_SIGN_IN_RETURN } from "@openbot/contracts/company-sign-in";

export function isCompanySignInReturn(path: string): boolean {
  return (
    path === MOBILE_COMPANY_SIGN_IN_RETURN ||
    path.startsWith(`${MOBILE_COMPANY_SIGN_IN_RETURN}?`) ||
    path.startsWith(`${MOBILE_COMPANY_SIGN_IN_RETURN}/`)
  );
}

export function companySignInReturnParams(url: string, clientState: string): URLSearchParams | null {
  if (!isCompanySignInReturn(url)) return null;
  const query = url.indexOf("?");
  if (query < 0) return null;
  const params = new URLSearchParams(url.slice(query + 1).split("#")[0]);
  return params.get("state") === clientState ? params : null;
}
