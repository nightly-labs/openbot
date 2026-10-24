import type { DeviceToolArgs, DeviceToolResults } from "@openbot/contracts/team-protocol/device-tools-v1";
import { Contact, ContactField } from "expo-contacts";
import { clip, requireText } from "./device-values";

export async function findContacts(args: DeviceToolArgs["contacts.find"]): Promise<DeviceToolResults["contacts.find"]> {
  requireText(args.query);
  const found = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES, ContactField.EMAILS], {
    name: args.query,
    limit: args.limit,
  });
  return {
    contacts: found
      .filter((contact) => contact.id.length > 0 && contact.id.length <= 256)
      .slice(0, args.limit)
      .map((contact) => ({
        id: contact.id,
        name: clip(contact.fullName, 200),
        phones: contact.phones.flatMap((phone) => (phone.number ? [clip(phone.number, 64)] : [])).slice(0, 5),
        emails: contact.emails.flatMap((email) => (email.address ? [clip(email.address, 320)] : [])).slice(0, 5),
      })),
  };
}
