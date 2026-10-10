/**
 * An error that keeps the code of a peer failure, such as `signal/host_busy`, in the `reference`
 * field that `errorReference` reads. The code holds only fixed identifiers, never server text.
 */
export function referencedError(message: string, reference: string | null | undefined): Error {
  return Object.assign(new Error(message), reference ? { reference } : {});
}
