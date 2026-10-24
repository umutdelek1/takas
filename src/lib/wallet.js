import { useEffect, useState } from "react";
import { chain, connectInjected, hasInjected, trError } from "./chain.js";

// MetaMask bağlantısı tüm sayfalarda ortak: tek kopya durum + abonelik.
let ext = null;
let msg = "";
const subs = new Set();
const emit = () => subs.forEach((f) => f());

export async function connectWallet() {
  msg = "MetaMask'ta onay bekleniyor…";
  emit();
  try {
    ext = { ...(await connectInjected()), chainOk: true };
    msg = "";
  } catch (e) {
    msg = trError(e);
  }
  emit();
}

export function disconnectWallet() {
  ext = null;
  msg = "";
  emit();
}

let listening = false;
function listen() {
  if (listening || !hasInjected()) return;
  listening = true;
  const eth = window.ethereum;
  eth.on?.("accountsChanged", (accs) => {
    if (!ext) return;
    if (!accs || accs.length === 0) disconnectWallet();
    else connectWallet();
  });
  eth.on?.("chainChanged", (cid) => {
    if (!ext) return;
    ext = { ...ext, chainOk: parseInt(cid, 16) === chain.id };
    emit();
  });
}

/** { ext, msg, available }: ext, bağlı MetaMask hesabıdır (yoksa null). */
export function useExtWallet() {
  const [, force] = useState(0);
  useEffect(() => {
    listen();
    const f = () => force((x) => x + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return { ext, msg, available: hasInjected() };
}

/** Telefonda MetaMask yoksa siteyi MetaMask uygulamasının tarayıcısında açan bağlantı. */
export const metamaskDeepLink = () => `https://metamask.app.link/dapp/${location.host}${location.pathname}${location.hash}`;
