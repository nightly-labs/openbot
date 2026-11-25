import { encodedModelId } from "@openbot/contracts/ipc";

export { encodedModelId };

const ENCODED_MODEL = "b64:";

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
