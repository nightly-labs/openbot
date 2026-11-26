import type { NearDepositAsset } from "@openbot/contracts/ipc";

export interface NearDepositCoin {
  symbol: string;
  networks: NearDepositAsset[];
}

const CHAIN_NAMES: Readonly<Record<string, string>> = {
  abs: "Abstract",
  aleo: "Aleo",
  aptos: "Aptos",
  arb: "Arbitrum",
  avax: "Avalanche",
  base: "Base",
  bch: "Bitcoin Cash",
  bera: "Berachain",
  bsc: "BNB Chain",
  btc: "Bitcoin",
  cardano: "Cardano",
  dash: "Dash",
  doge: "Dogecoin",
  eth: "Ethereum",
  gnosis: "Gnosis",
  hood: "Robinhood Chain",
  hypercore: "HyperCore",
  ltc: "Litecoin",
  miden: "Miden",
  monad: "Monad",
  movement: "Movement",
  near: "NEAR",
  op: "Optimism",
  plasma: "Plasma",
  pol: "Polygon",
  scroll: "Scroll",
  sol: "Solana",
  starknet: "Starknet",
  stellar: "Stellar",
  sui: "Sui",
  ton: "TON",
  tron: "Tron",
  xlayer: "X Layer",
  xrp: "XRP Ledger",
  zec: "Zcash",
};

const POPULAR_COINS = ["USDC", "USDT", "ETH", "BTC", "SOL", "NEAR", "WNEAR", "ZEC"];

const CHAIN_ORDER = ["eth", "base", "arb", "sol", "near", "bsc", "pol", "op", "avax", "tron", "ton", "btc"];

const PREFERRED_CHAIN: Readonly<Record<string, string>> = {
  ADA: "cardano",
  APT: "aptos",
  AVAX: "avax",
  BCH: "bch",
  BNB: "bsc",
  BTC: "btc",
  DASH: "dash",
  DOGE: "doge",
  LTC: "ltc",
  NEAR: "near",
  SOL: "sol",
  SUI: "sui",
  TON: "ton",
  TRX: "tron",
  USDC: "near",
  USDT: "near",
  WNEAR: "near",
  XLM: "stellar",
  XRP: "xrp",
  ZEC: "zec",
};

export const DEFAULT_DEPOSIT_COIN = "USDC";

export const chainName = (blockchain: string) => CHAIN_NAMES[blockchain] ?? blockchain.toUpperCase();

const rank = (list: readonly string[], value: string) => {
  const index = list.indexOf(value);
  return index === -1 ? list.length : index;
};

const byName = (left: string, right: string) => left.localeCompare(right, "en", { sensitivity: "base" });

function networkOrder(symbol: string) {
  const preferred = PREFERRED_CHAIN[symbol.toUpperCase()];
  return (left: NearDepositAsset, right: NearDepositAsset) => {
    const preferredOrder = Number(right.blockchain === preferred) - Number(left.blockchain === preferred);
    if (preferredOrder !== 0) return preferredOrder;
    const order = rank(CHAIN_ORDER, left.blockchain) - rank(CHAIN_ORDER, right.blockchain);
    return order !== 0 ? order : byName(chainName(left.blockchain), chainName(right.blockchain));
  };
}

export function nearDepositCoins(assets: readonly NearDepositAsset[]): NearDepositCoin[] {
  const groups = new Map<string, NearDepositAsset[]>();
  for (const asset of assets) groups.set(asset.symbol, [...(groups.get(asset.symbol) ?? []), asset]);
  return [...groups]
    .map(([symbol, networks]) => ({ symbol, networks: networks.sort(networkOrder(symbol)) }))
    .sort((left, right) => {
      const order = rank(POPULAR_COINS, left.symbol.toUpperCase()) - rank(POPULAR_COINS, right.symbol.toUpperCase());
      return order !== 0 ? order : byName(left.symbol, right.symbol);
    });
}

const TOKEN_STANDARDS: Readonly<Record<string, string>> = {
  "aptos-fa": "FA",
  erc20: "ERC-20",
  hip1: "HIP-1",
  nep141: "NEP-141",
  nep245: "NEP-245",
  spl: "SPL",
};

function tokenStandard(assetId: string) {
  const parts = assetId.split(":");
  const kind = (parts[0] === "1cs_v1" ? parts[2] : parts[0]) ?? "";
  return TOKEN_STANDARDS[kind] ?? kind.toUpperCase();
}

function shortAddress(assetId: string) {
  const address = assetId.slice(assetId.lastIndexOf(":") + 1);
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function networkDetail(coin: NearDepositCoin, asset: NearDepositAsset): string | null {
  const twins = coin.networks.filter(
    (other) => other.assetId !== asset.assetId && other.blockchain === asset.blockchain,
  );
  if (twins.length === 0) return null;
  const standard = tokenStandard(asset.assetId);
  const sameStandard = twins.some((other) => tokenStandard(other.assetId) === standard);
  return sameStandard ? `${standard} ${shortAddress(asset.assetId)}` : standard;
}
