// The one wire message that Baileys reads itself: the prekey message of the Signal protocol, to
// see the sender's identity key before it decrypts. Only the field numbers of the format are used.
import protobuf from "protobufjs";

const root = protobuf.Root.fromJSON({
  nested: {
    PreKeyWhisperMessage: {
      fields: {
        preKeyId: { type: "uint32", id: 1 },
        baseKey: { type: "bytes", id: 2 },
        identityKey: { type: "bytes", id: 3 },
        message: { type: "bytes", id: 4 },
        registrationId: { type: "uint32", id: 5 },
        signedPreKeyId: { type: "uint32", id: 6 },
      },
    },
    SessionStructure: {
      fields: {
        sessionVersion: { type: "uint32", id: 1 },
        remoteRegistrationId: { type: "uint32", id: 10 },
        aliceBaseKey: { type: "bytes", id: 13 },
      },
    },
    RecordStructure: {
      fields: {
        currentSession: { type: "SessionStructure", id: 1 },
      },
    },
  },
});

export const PreKeyWhisperMessage = root.lookupType("PreKeyWhisperMessage");
export const RecordStructure = root.lookupType("RecordStructure");
