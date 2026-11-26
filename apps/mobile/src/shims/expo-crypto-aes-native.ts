import { requireOptionalNativeModule, UnavailabilityError } from "expo";

function unavailable(): never {
  throw new UnavailabilityError("expo-crypto", "AES");
}

async function unavailableAsync(): Promise<never> {
  unavailable();
}

class UnavailableEncryptionKey {
  constructor() {
    unavailable();
  }
  static generate = unavailableAsync;
  static import = unavailableAsync;
}

class UnavailableSealedData {
  constructor() {
    unavailable();
  }
  static fromParts = unavailable;
  static fromCombined = unavailable;
}

export default requireOptionalNativeModule("ExpoCryptoAES") ?? {
  EncryptionKey: UnavailableEncryptionKey,
  SealedData: UnavailableSealedData,
  encryptAsync: unavailableAsync,
  decryptAsync: unavailableAsync,
};
