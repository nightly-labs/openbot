import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface ProvidersPort {
  cancelProviderCodeLogin: OpenBotDesktopApi["cancelProviderCodeLogin"];
  connectProvider: OpenBotDesktopApi["connectProvider"];
  connectProviderInMainlandChina: OpenBotDesktopApi["connectProviderInMainlandChina"];
  cancelProviderSignIn: OpenBotDesktopApi["cancelProviderSignIn"];
  refreshAgentProviders: OpenBotDesktopApi["refreshAgentProviders"];
  setProviderOn: OpenBotDesktopApi["setProviderOn"];
  restartProvider: OpenBotDesktopApi["restartProvider"];
  cancelProviderRestart: OpenBotDesktopApi["cancelProviderRestart"];
  chooseInstalledCli: OpenBotDesktopApi["chooseInstalledCli"];
  startProviderCodeLogin: OpenBotDesktopApi["startProviderCodeLogin"];
  providerRuntimes: OpenBotDesktopApi["providerRuntimes"];
  connectProviderAccount: OpenBotDesktopApi["connectProviderAccount"];
  connectProviderAccountKey: OpenBotDesktopApi["connectProviderAccountKey"];
  cancelProviderAccountSignIn: OpenBotDesktopApi["cancelProviderAccountSignIn"];
  renameProviderAccount: OpenBotDesktopApi["renameProviderAccount"];
  removeProviderAccount: OpenBotDesktopApi["removeProviderAccount"];
  setProviderAccountPool: OpenBotDesktopApi["setProviderAccountPool"];
  signOutProvider: OpenBotDesktopApi["signOutProvider"];
  providerUsageResets: OpenBotDesktopApi["providerUsageResets"];
  resetProviderUsage: OpenBotDesktopApi["resetProviderUsage"];
  providerAdmin: OpenBotDesktopApi["providerAdmin"];
}

export function providersPort(): ProvidersPort {
  return window.openbot;
}
