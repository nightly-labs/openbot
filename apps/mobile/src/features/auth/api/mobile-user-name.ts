import type { CentralAuthUser } from "@openbot/contracts/ipc";

export function mobileUserName(user: CentralAuthUser): string {
  if (user.name) return user.name;
  const separator = user.email.indexOf("@");
  return separator > 0 ? user.email.slice(0, separator) : user.email;
}
