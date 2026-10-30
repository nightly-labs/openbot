import { SUPERTONIC_MODEL_DIRECTORY, SUPERTONIC_MODEL_FILES } from "@openbot/contracts/speech-models";
import { createModelDownload } from "./model-download";
import { speechNative } from "./speech-native";

/** Supertonic 3, the voice that reads replies on the phone. */
export const supertonicModel = createModelDownload({
  directory: SUPERTONIC_MODEL_DIRECTORY,
  files: SUPERTONIC_MODEL_FILES,
  unload: async () => {
    await speechNative?.unload();
  },
});

export const useSupertonicModel = supertonicModel.useModel;
