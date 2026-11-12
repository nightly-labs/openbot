// The real `react-native` for the files in this folder. Metro resolves this name only for them (see
// `metro.config.js`), because every other `react-native` import goes to the Uniwind wrappers.
declare module "openbot-original-react-native" {
  export * from "react-native";
}
