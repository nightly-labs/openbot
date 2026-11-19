import { isAgentModel } from "@openbot/contracts/ipc";

const ENCODED_MODEL = "b64:";

export function encodedModelId(prefix: string, value: string): string {
  const plain = `${prefix}${value}`;
  return isAgentModel(plain) && !value.startsWith(ENCODED_MODEL)
    ? plain
    : `${prefix}${ENCODED_MODEL}${Buffer.from(value, "utf8").toString("base64url")}`;
}

export function providerModelValue(model: string): string {
  return model.startsWith(ENCODED_MODEL)
    ? Buffer.from(model.slice(ENCODED_MODEL.length), "base64url").toString("utf8")
    : model;
}

export function isEncodedModelOf(id: string, value: string): boolean {
  const start = id.lastIndexOf("/") + 1;
  if (!id.startsWith(ENCODED_MODEL, start)) return false;
  const prefix = id.slice(0, start);
  return value.startsWith(prefix) && encodedModelId(prefix, value.slice(prefix.length)) === id;
}
