import { useCallback, useEffect, useRef, useState } from "react";
import { CONTRACT, DEBT_CHOICES, EXPLORER, TEMP_COLLATERAL, client, trError, write } from "../lib/chain.js";
import { postJson, useTakasState } from "../lib/api.js";
import { mon, monLabel, shortAddr } from "../lib/format.js";
import { companyName, initials } from "../lib/names.js";
import { connectWallet, metamaskDeepLink, useExtWallet } from "../lib/wallet.js";
import { Brand } from "./Brand.jsx";
import { WalletButton } from "./WalletButton.jsx";

const lc = (s) => (s || "").toLowerCase();
const dripKey = (a) => `takas.drip.${lc(a)}`;

export default function Play() {
  // MetaMask zorunlu: kayıt ve borç yazma bağlı cüzdanla, Monad Testnet'te imzalanır.
  const { ext, msg: walletMsg, available } = useExtWallet();
  const ready = !!ext && ext.chainOk;
  const account = ext ?? { address: null };
  const { state, error: stateError, refresh } = useTakasState(2000);
  const [balance, setBalance] = useState(null);
  const [dripMsg, setDripMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null); // { kind: "ok" | "err", text }
  const [target, setTarget] = useState(null);
  const [amount, setAmount] = useState(DEBT_CHOICES[0]);
  const [result, setResult] = useState(null);
  const prev = useRef({ session: null, me: null });

  const me = ready && state ? (state.members.find((m) => lc(m.address) === lc(account.address)) ?? null) : null;

  // ---- bakiye ----
  const readBalance = useCallback(async () => {
    if (!account.address) {
      setBalance(null);
      return;
    }
    try {
      setBalance(await client.getBalance({ address: account.address }));
    } catch {
      /* bir sonraki turda tekrar denenir */
    }
  }, [account.address]);

  useEffect(() => {
    readBalance();
    const t = setInterval(readBalance, 2000);
    return () => clearInterval(t);
  }, [readBalance]);

  // ---- test MON: bağlı cüzdanın bakiyesi 0 ise bir kez otomatik istenir ----
  const askDrip = useCallback(async () => {
    if (!account.address) return;
    setDripMsg("MON isteniyor…");
    try {
      const r = await postJson("/api/drip", { address: account.address });
      try {
        localStorage.setItem(dripKey(account.address), "1");
      } catch {
        /* kalıcı değil */
      }
      setDripMsg(r.already ? "Bu cüzdan daha önce kullanılmış; test MON yalnızca boş, yeni cüzdanlara gönderilir." : "0,2 MON geldi.");
      readBalance();
    } catch (e) {
      setDripMsg(`MON alınamadı: ${e.message}`);
    }
  }, [account.address, readBalance]);

  useEffect(() => {
    if (!ready || balance !== 0n) return;
    let asked = false;
    try {
      asked = localStorage.getItem(dripKey(account.address)) === "1";
    } catch {
      /* yok say */
    }
    if (!asked) askDrip();
  }, [ready, balance, account.address, askDrip]);

  // ---- cüzdan değişince önceki cüzdanın durumu taşınmaz ----
  useEffect(() => {
    prev.current = { session: null, me: null };
    setResult(null);
    setTarget(null);
    setBalance(null);
    setDripMsg("");
  }, [account.address]);

  // ---- takas sonucu ----
  useEffect(() => {
    if (!state) return;
    const p = prev.current;
    if (p.session !== null && state.session > p.session && p.me && me) {
      const delta = BigInt(me.collateralWei) - BigInt(p.me.collateralWei);
      setResult({
        session: state.session,
        delta,
        closed: me.sicil - p.me.sicil,
        stillOpen: state.invoices.filter((i) => lc(i.debtor) === lc(account.address)).length,
        last: state.lastSettle,
      });
    }
    prev.current = { session: state.session, me: me ? { ...me } : null };
  }, [state, me, account.address]);

  // ---- işlemler ----
  async function run(label, fn, okText) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: okText });
      refresh();
      readBalance();
    } catch (e) {
      setMsg({ kind: "err", text: trError(e) });
    } finally {
      setBusy("");
    }
  }

  const register = () =>
    run("register", () => write(account, "register", [], TEMP_COLLATERAL), "Şirketin kaydedildi. Artık borç yazabilirsin.");

  const writeDebt = () => {
    const t = target;
    const a = amount;
    return run(
      "owe",
      () => write(account, "owe", [t.address, a]),
      `${companyName(t.id)} için ${mon(a)} MON borç yazıldı.`,
    ).then(() => setTarget(null));
  };

  // ---- net durum ----
  const mine = state ? state.invoices.filter((i) => lc(i.debtor) === lc(account.address)) : [];
  const owedToMe = state ? state.invoices.filter((i) => lc(i.creditor) === lc(account.address)) : [];
  const sum = (arr) => arr.reduce((s, i) => s + BigInt(i.amountWei), 0n);
  const debt = sum(mine);
  const credit = sum(owedToMe);
  const net = debt - credit;
  const cashNeeded = net > 0n ? net : 0n;
  const nameOf = (addr) => {
    const m = state?.members.find((x) => lc(x.address) === lc(addr));
    return m ? companyName(m.id) : shortAddr(addr);
  };

  const others = state ? state.members.filter((m) => lc(m.address) !== lc(account.address)) : [];
  const hasGas = balance !== null && balance > 0n;

  return (
    <div className="phone">
      <div className="topbar">
        <Brand />
        <WalletButton />
      </div>

      {!ext && (
        <section className="card">
          <h2>Cüzdanını bağla</h2>
          <p style={{ marginBottom: 14 }}>
            TAKAS'ta kayıt ve borç yazma MetaMask ile imzalanır. Bağlanınca Monad Testnet MetaMask'a otomatik eklenir ve seçilir.
          </p>
          {available ? (
            <button className="btn block" onClick={connectWallet} disabled={walletMsg.includes("bekleniyor")}>
              {walletMsg.includes("bekleniyor") ? "Onay bekleniyor…" : "MetaMask ile bağlan"}
            </button>
          ) : (
            <>
              <a className="btn block" href={metamaskDeepLink()}>
                MetaMask uygulamasında aç
              </a>
              <a className="btn ghost block" style={{ marginTop: 8 }} href="https://metamask.io/download" target="_blank" rel="noreferrer">
                MetaMask yükle
              </a>
            </>
          )}
          {walletMsg && !walletMsg.includes("bekleniyor") && (
            <p className="err" style={{ marginTop: 8 }}>
              {walletMsg}
            </p>
          )}
        </section>
      )}

      {ext && !ext.chainOk && (
        <section className="card">
          <h2>Ağ</h2>
          <p style={{ marginBottom: 12 }}>MetaMask'ta Monad Testnet seçili değil.</p>
          <button className="btn block" onClick={connectWallet}>
            Monad Testnet'e geç
          </button>
        </section>
      )}

      {ready && (
        <section className="card">
          <h2>Cüzdan</h2>
          <div className="balance num">{balance === null ? "…" : `${mon(balance)} MON`}</div>
          <div className="addr num">{shortAddr(account.address)} · MetaMask · Monad Testnet</div>
          {dripMsg && (
            <p className={dripMsg.startsWith("MON alınamadı") ? "err" : "muted"} style={{ marginTop: 8 }}>
              {dripMsg}
            </p>
          )}
          {balance !== null && balance < TEMP_COLLATERAL && !me && (
            <button className="btn ghost block" style={{ marginTop: 12 }} onClick={askDrip}>
              Test MON iste
            </button>
          )}
        </section>
      )}

      {!state && !stateError && (
        <section className="card muted">
          <span className="spinner" />
          Ağ yükleniyor…
        </section>
      )}
      {stateError && !state && <section className="card err">Bağlantı kurulamadı: {stateError}</section>}

      {ready && state && !me && (
        <section className="card">
          <h2>Şirketini kaydet</h2>
          <p style={{ marginBottom: 14 }}>
            Teminat olarak <b className="num">{monLabel(TEMP_COLLATERAL)}</b> yatırırsın. Takasta net borcun bu teminattan ödenir.
          </p>
          <button className="btn block" disabled={!hasGas || !!busy} onClick={register}>
            {busy === "register" ? (
              <>
                <span className="spinner" />
                Kaydediliyor…
              </>
            ) : (
              "Şirketini kaydet"
            )}
          </button>
        </section>
      )}

      {me && (
        <>
          <section className="card">
            <h2>Şirketin</h2>
            <div className="row">
              <div className="row" style={{ justifyContent: "flex-start" }}>
                <span className="badge">{initials(me.id)}</span>
                <b style={{ fontSize: 18 }}>{companyName(me.id)}</b>
              </div>
              <span className="tag">Sicil {me.sicil}</span>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              Teminat: <b className="num" style={{ color: "var(--text)" }}>{monLabel(me.collateralWei)}</b>
            </p>
          </section>

          <section className="card">
            <h2>Borç yaz</h2>
            {others.length === 0 ? (
              <p className="muted">Henüz başka işletme yok. Diğerleri şirketini kaydedince burada görünür.</p>
            ) : (
              <>
                <p className="muted" style={{ marginBottom: 8 }}>
                  Hangi işletmeye borçlusun?
                </p>
                <div className="company-list">
                  {others.map((m) => (
                    <button key={m.id} className={`company ${target?.id === m.id ? "on" : ""}`} onClick={() => setTarget(m)}>
                      <span className="badge">{initials(m.id)}</span>
                      <span className="grow">{companyName(m.id)}</span>
                      <span className="muted num" style={{ fontSize: 13 }}>
                        Sicil {m.sicil}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="muted" style={{ margin: "14px 0 8px" }}>
                  Tutar
                </p>
                <div className="chips">
                  {DEBT_CHOICES.map((a) => (
                    <button key={a} className={`chip num ${amount === a ? "on" : ""}`} onClick={() => setAmount(a)}>
                      {mon(a)} MON
                    </button>
                  ))}
                </div>
                <button className="btn block" style={{ marginTop: 16 }} disabled={!target || !hasGas || !!busy} onClick={writeDebt}>
                  {busy === "owe" ? (
                    <>
                      <span className="spinner" />
                      Yazılıyor…
                    </>
                  ) : target ? (
                    `${companyName(target.id)} · ${mon(amount)} MON borç yaz`
                  ) : (
                    "Önce bir işletme seç"
                  )}
                </button>
              </>
            )}
          </section>

          <section className="card">
            <h2>Net durum</h2>
            <div className="lines">
              {mine.length === 0 && owedToMe.length === 0 && <p className="muted">Açık faturan yok.</p>}
              {mine.map((i, k) => (
                <div className="row" key={`d${k}`}>
                  <span>
                    <span className="muted">Borç:</span> {nameOf(i.creditor)}
                  </span>
                  <b className="num debt">−{mon(i.amountWei)}</b>
                </div>
              ))}
              {owedToMe.map((i, k) => (
                <div className="row" key={`c${k}`}>
                  <span>
                    <span className="muted">Alacak:</span> {nameOf(i.debtor)}
                  </span>
                  <b className="num credit">+{mon(i.amountWei)}</b>
                </div>
              ))}
            </div>
            {(mine.length > 0 || owedToMe.length > 0) && (
              <>
                <hr className="divider" />
                <div className="row">
                  <span>Takasta ödeyeceğin nakit</span>
                  <b className="net num">{monLabel(cashNeeded)}</b>
                </div>
                <p className="muted" style={{ marginTop: 6 }}>
                  Brüt borcun {monLabel(debt)}; takasla {monLabel(debt - cashNeeded)} nakit tasarruf edersin.
                </p>
              </>
            )}
          </section>
        </>
      )}

      {msg && (
        <section className="card">
          <p className={msg.kind === "ok" ? "ok" : "err"}>{msg.text}</p>
        </section>
      )}

      {result && (
        <section className="card result-card" role="status">
          <h2>Takas tamam · #{result.session}</h2>
          <div className="big-num num">
            {result.delta >= 0n ? "+" : "−"}
            {mon(result.delta < 0n ? -result.delta : result.delta)} MON
          </div>
          <p style={{ marginTop: 8 }}>
            {result.closed > 0
              ? `${result.closed} borcun kapandı, sicilin arttı.`
              : result.stillOpen > 0
                ? "Teminatın yetmediği için faturaların bu turda dışarıda kaldı. Teminat ekleyip sonraki takasa katılabilirsin."
                : "Bu turda senin faturan yoktu."}
          </p>
          {result.last && (
            <p style={{ marginTop: 8 }}>
              Ağda {result.last.stats.invoices} fatura kapandı; {monLabel(result.last.stats.grossWei)} borç yerine yalnızca{" "}
              {monLabel(result.last.stats.cashWei)} nakit el değiştirdi.{" "}
              <a href={result.last.explorer} target="_blank" rel="noreferrer">
                İşlemi gör
              </a>
            </p>
          )}
          <button className="btn block" style={{ marginTop: 14 }} onClick={() => setResult(null)}>
            Tamam
          </button>
        </section>
      )}

      <p className="muted" style={{ fontSize: 12, textAlign: "center" }}>
        Şirket adları kurgusaldır. Kontrat:{" "}
        <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer" className="num">
          {shortAddr(CONTRACT)}
        </a>
      </p>
    </div>
  );
}
