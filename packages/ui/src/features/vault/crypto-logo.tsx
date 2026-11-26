import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import absChain from "../../assets/crypto-logos/chains/abs.svg";
import aptosChain from "../../assets/crypto-logos/chains/aptos.svg";
import arbChain from "../../assets/crypto-logos/chains/arb.svg";
import avaxChain from "../../assets/crypto-logos/chains/avax.svg";
import baseChain from "../../assets/crypto-logos/chains/base.svg";
import beraChain from "../../assets/crypto-logos/chains/bera.svg";
import bscChain from "../../assets/crypto-logos/chains/bsc.svg";
import btcChain from "../../assets/crypto-logos/chains/btc.svg";
import cardanoChain from "../../assets/crypto-logos/chains/cardano.svg";
import ethChain from "../../assets/crypto-logos/chains/eth.svg";
import gnosisChain from "../../assets/crypto-logos/chains/gnosis.svg";
import hoodChain from "../../assets/crypto-logos/chains/hood.svg";
import hypercoreChain from "../../assets/crypto-logos/chains/hypercore.svg";
import ltcChain from "../../assets/crypto-logos/chains/ltc.svg";
import monadChain from "../../assets/crypto-logos/chains/monad.svg";
import nearChain from "../../assets/crypto-logos/chains/near.svg";
import opChain from "../../assets/crypto-logos/chains/op.svg";
import plasmaChain from "../../assets/crypto-logos/chains/plasma.svg";
import polChain from "../../assets/crypto-logos/chains/pol.svg";
import scrollChain from "../../assets/crypto-logos/chains/scroll.svg";
import solChain from "../../assets/crypto-logos/chains/sol.svg";
import starknetChain from "../../assets/crypto-logos/chains/starknet.svg";
import stellarChain from "../../assets/crypto-logos/chains/stellar.svg";
import suiChain from "../../assets/crypto-logos/chains/sui.svg";
import tonChain from "../../assets/crypto-logos/chains/ton.svg";
import tronChain from "../../assets/crypto-logos/chains/tron.svg";
import xlayerChain from "../../assets/crypto-logos/chains/xlayer.svg";
import xrpChain from "../../assets/crypto-logos/chains/xrp.svg";
import adaToken from "../../assets/crypto-logos/tokens/ada.svg";
import aptToken from "../../assets/crypto-logos/tokens/apt.svg";
import auroraToken from "../../assets/crypto-logos/tokens/aurora.svg";
import avaxToken from "../../assets/crypto-logos/tokens/avax.svg";
import bnbToken from "../../assets/crypto-logos/tokens/bnb.svg";
import btcToken from "../../assets/crypto-logos/tokens/btc.svg";
import cbbtcToken from "../../assets/crypto-logos/tokens/cbbtc.svg";
import daiToken from "../../assets/crypto-logos/tokens/dai.svg";
import dogeToken from "../../assets/crypto-logos/tokens/doge.svg";
import ethToken from "../../assets/crypto-logos/tokens/eth.svg";
import fraxToken from "../../assets/crypto-logos/tokens/frax.svg";
import hapiToken from "../../assets/crypto-logos/tokens/hapi.svg";
import ltcToken from "../../assets/crypto-logos/tokens/ltc.svg";
import nearToken from "../../assets/crypto-logos/tokens/near.svg";
import nproToken from "../../assets/crypto-logos/tokens/npro.svg";
import polToken from "../../assets/crypto-logos/tokens/pol.svg";
import solToken from "../../assets/crypto-logos/tokens/sol.svg";
import suiToken from "../../assets/crypto-logos/tokens/sui.svg";
import trxToken from "../../assets/crypto-logos/tokens/trx.svg";
import usdcToken from "../../assets/crypto-logos/tokens/usdc.svg";
import usdtToken from "../../assets/crypto-logos/tokens/usdt.svg";
import wbtcToken from "../../assets/crypto-logos/tokens/wbtc.svg";
import xautToken from "../../assets/crypto-logos/tokens/xaut.svg";
import xlmToken from "../../assets/crypto-logos/tokens/xlm.svg";
import xrpToken from "../../assets/crypto-logos/tokens/xrp.svg";
import zecToken from "../../assets/crypto-logos/tokens/zec.svg";
import { cx } from "../../utils";

const TOKEN_LOGOS: Readonly<Record<string, string>> = {
  ADA: adaToken,
  AURORA: auroraToken,
  CBBTC: cbbtcToken,
  DOGE: dogeToken,
  FRAX: fraxToken,
  HAPI: hapiToken,
  NPRO: nproToken,
  XAUT: xautToken,
  APT: aptToken,
  AVAX: avaxToken,
  BNB: bnbToken,
  BTC: btcToken,
  DAI: daiToken,
  ETH: ethToken,
  LTC: ltcToken,
  NEAR: nearToken,
  POL: polToken,
  SOL: solToken,
  SUI: suiToken,
  TON: tonChain,
  TRX: trxToken,
  USDC: usdcToken,
  USDT: usdtToken,
  WBTC: wbtcToken,
  WNEAR: nearToken,
  XLM: xlmToken,
  XRP: xrpToken,
  ZEC: zecToken,
};

const CHAIN_LOGOS: Readonly<Record<string, string>> = {
  abs: absChain,
  doge: dogeToken,
  hood: hoodChain,
  hypercore: hypercoreChain,
  aptos: aptosChain,
  arb: arbChain,
  avax: avaxChain,
  base: baseChain,
  bera: beraChain,
  bsc: bscChain,
  btc: btcChain,
  cardano: cardanoChain,
  eth: ethChain,
  gnosis: gnosisChain,
  ltc: ltcChain,
  monad: monadChain,
  near: nearChain,
  op: opChain,
  plasma: plasmaChain,
  pol: polChain,
  scroll: scrollChain,
  sol: solChain,
  starknet: starknetChain,
  stellar: stellarChain,
  sui: suiChain,
  ton: tonChain,
  tron: tronChain,
  xlayer: xlayerChain,
  xrp: xrpChain,
  zec: zecToken,
};

function CryptoLogo(props: { src: string | undefined; name: string; class?: string | undefined }): JSX.Element {
  return (
    <Show
      when={props.src}
      fallback={
        <span class={cx("crypto-logo crypto-logo-letter", props.class)} aria-hidden="true">
          {props.name.slice(0, 1).toUpperCase()}
        </span>
      }
    >
      {(src) => <img class={cx("crypto-logo", props.class)} src={src()} alt="" aria-hidden="true" />}
    </Show>
  );
}

export function TokenLogo(props: { symbol: string; class?: string | undefined }): JSX.Element {
  return <CryptoLogo src={TOKEN_LOGOS[props.symbol.toUpperCase()]} name={props.symbol} class={props.class} />;
}

export function ChainLogo(props: { blockchain: string; class?: string | undefined }): JSX.Element {
  return <CryptoLogo src={CHAIN_LOGOS[props.blockchain]} name={props.blockchain} class={props.class} />;
}
