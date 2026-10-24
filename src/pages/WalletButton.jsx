import { useState } from "react";
import { connectWallet, disconnectWallet, useExtWallet } from "../lib/wallet.js";
import { shortAddr } from "../lib/format.js";

/** Header'daki cüzdan butonu: MetaMask yoksa yükleme linki, bağlıysa adres + ağ rozeti. */
export function WalletButton() {
  const { ext, msg, available } = useExtWallet();
  const [open, setOpen] = useState(false);

  if (!available) {
    return (
      <a className="wallet-btn" href="https://metamask.io/download" target="_blank" rel="noreferrer">
        MetaMask yükle
      </a>
    );
  }
  if (!ext) {
    const waiting = msg.includes("bekleniyor");
    return (
      <span className="wallet-wrap">
        <button className="wallet-btn primary" onClick={connectWallet} disabled={waiting}>
          {waiting ? "Onay bekleniyor…" : "Cüzdan bağla"}
        </button>
        {msg && !waiting && <span className="wallet-err">{msg}</span>}
      </span>
    );
  }
  return (
    <span className="wallet-wrap">
      <button className="wallet-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="num">{shortAddr(ext.address)}</span>
        <span className={`tag ${ext.chainOk ? "measured" : ""}`}>{ext.chainOk ? "Monad Testnet" : "Yanlış ağ"}</span>
      </button>
      {open && (
        <span className="wallet-menu">
          {!ext.chainOk && (
            <button
              onClick={() => {
                setOpen(false);
                connectWallet();
              }}
            >
              Monad Testnet'e geç
            </button>
          )}
          <button
            onClick={() => {
              setOpen(false);
              disconnectWallet();
            }}
          >
            Bağlantıyı kes
          </button>
        </span>
      )}
    </span>
  );
}
