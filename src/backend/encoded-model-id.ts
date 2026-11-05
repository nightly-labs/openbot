import { isAgentModel } from "@openbot/contracts/ipc";

/** The start of a model value that `encodedModelId` encoded, because the contract charset refuses it. */
const ENCODED_MODEL = "b64:";

/**
 * The model id of a value that a provider reported, after `prefix`.
 *
 * The contract charset is released: the model list decoders of older clients and the Team API fail
 * closed on the whole array. A value that the charset refuses, such as DeepSeek Harness's
 * `["deepseek-official","deepseek-v4-flash"]` or Pi's `@cf/moonshotai/kimi-k2.6`, goes in base64url
 * after `ENCODED_MODEL`, and `providerModelValue` gives the provider its own value back. A value that
 * starts with the marker is encoded too, so no value is read as another. The result can still be
 * refused, as one too long; that id is then dropped alone, by the caller or by the model catalog.
 */
export function encodedModelId(prefix: string, value: string): string {
  const plain = `${prefix}${value}`;
  return isAgentModel(plain) && !value.startsWith(ENCODED_MODEL)
    ? plain
    : `${prefix}${ENCODED_MODEL}${Buffer.from(value, "utf8").toString("base64url")}`;
}

/** The provider's own value of a model id part that `encodedModelId` made. */
export function providerModelValue(model: string): string {
  return model.startsWith(ENCODED_MODEL)
    ? Buffer.from(model.slice(ENCODED_MODEL.length), "base64url").toString("utf8")
    : model;
}
