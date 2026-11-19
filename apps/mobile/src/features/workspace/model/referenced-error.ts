export function referencedError(message: string, reference: string | null | undefined): Error {
  return Object.assign(new Error(message), reference ? { reference } : {});
}
