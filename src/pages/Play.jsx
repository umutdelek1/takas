import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatEther } from "viem";
import { CONTRACT, DEBT_CHOICES, EXPLORER, TEMP_COLLATERAL, client, loadWallet, trError, write } from "../lib/chain.js";
import { postJson, useTakasState } from "../lib/api.js";
import { mon, monLabel, shortAddr } from "../lib/format.js";
import { merchantName, toward } from "../lib/names.js";
import { Brand } from "./Brand.jsx";

const DRIP_KEY = "takas.dripAsked";
const lc = (s) => (s || "").toLowerCase();

export default function Play() {
  const account = useMemo(() => loadWallet(), []);
  const { state, error: stateError, refresh } = useTakasState(2000);
  const [balance, setBalance] = useState(null);
  const [dripMsg, setDripMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null); // { kind: "ok" | "err", text }
  const [target, setTarget] = useState(null);
  const [amount, setAmount] = useState(DEBT_CHOICES[0]);
  const [result, setResult] = useState(null);
  const prev = useRef({ session: null, me: null });

  const me = state?.members.find((m) => lc(m.address) === lc(account.address)) ?? null;

  // ---- bakiye ----
  const readBalance = useCallback(async () => {
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

  // ---- otomatik MON ----
  const askDrip = useCallback(async () => {
    setDripMsg("MON isteniyor…");
    try {
      const r = await postJson("/api/drip", { address: account.address });
      try {
        localStorage.setItem(DRIP_KEY, "1");
      } catch {
        /* kalıcı değil */
      }
      setDripMsg(r.already ? "" : "0,2 MON geldi.");
      readBalance();
    } catch (e) {
      setDripMsg(`MON alınamadı: ${e.message}`);
    }
  }, [account.address, readBalance]);

  useEffect(() => {
    let asked = false;
    try {
      asked = localStorage.getItem(DRIP_KEY) === "1";
    } catch {
      /* yok say */
    }
    if (!asked) askDrip();
  }, [askDrip]);

  // ---- takas sonucu ----
  useEffect(() => {
    if (!state) return;
    const p = prev.current;
    if (p.session !== null && state.session > p.session && p.me) {
      const nowMe = me;
      if (nowMe) {
        const delta = BigInt(nowMe.collateralWei) - BigInt(p.me.collateralWei);
        setResult({
          session: state.session,
          delta,
          closed: nowMe.sicil - p.me.sicil,
          stillOpen: state.invoices.filter((i) => lc(i.debtor) === lc(account.address)).length,
          last: state.lastSettle,
        });
      }
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

  const openShop = () =>
    run("register", () => write(account, "register", [], TEMP_COLLATERAL), "Dükkânın açıldı! Artık borç yazabilirsin.");

  const writeDebt = () => {
    const t = target;
    const a = amount;
    return run(
      "owe",
      () => write(account, "owe", [t.address, a]),
      `${toward(merchantName(t.id))} ${mon(a)} MON borç yazıldı.`,
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
    return m ? merchantName(m.id) : shortAddr(addr);
  };

  const others = state ? state.members.filter((m) => lc(m.address) !== lc(account.address)) : [];
  const hasGas = balance !== null && balance > 0n;

  return (
    <div className="phone">
      <div className="topbar">
        <Brand />
        <span className="pill">Monad testnet</span>
      </div>

      <section className="card">
        <h2>Cüzdanın</h2>
        <div className="balance mono">{balance === null ? "…" : `${mon(balance)} MON`}</div>
        <div className="addr">{shortAddr(account.address)}</div>
        {dripMsg && (
          <p className={dripMsg.startsWith("MON alınamadı") ? "err" : "muted"} style={{ marginTop: 8 }}>
            {dripMsg}
          </p>
        )}
        {balance === 0n && (
          <button className="btn amber block" style={{ marginTop: 10 }} onClick={askDrip}>
            MON iste
          </button>
        )}
      </section>

      {!state && !stateError && (
        <section className="card muted">
          <span className="spinner" />
          Çarşı yükleniyor…
        </section>
      )}
      {stateError && !state && <section className="card err">Bağlantı kurulamadı: {stateError}</section>}

      {state && !me && (
        <section className="card">
          <h2>Dükkân aç</h2>
          <p style={{ marginBottom: 12 }}>
            Teminat olarak <b>{monLabel(TEMP_COLLATERAL)}</b> yatırırsın. Takasta net borcun bu teminattan ödenir.
          </p>
          <button className="btn block" disabled={!hasGas || !!busy} onClick={openShop}>
            {busy === "register" ? (
              <>
                <span className="spinner" />
                Dükkân açılıyor…
              </>
            ) : (
              "Dükkânı aç"
            )}
          </button>
        </section>
      )}

      {me && (
        <>
          <section className="card">
            <h2>Dükkânın</h2>
            <div className="row">
              <b style={{ fontSize: 20 }}>{merchantName(me.id)}</b>
              <span className="pill">Sicil: {me.sicil}</span>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              Teminat: <b className="mono">{monLabel(me.collateralWei)}</b>
            </p>
          </section>

          <section className="card">
            <h2>Borç yaz</h2>
            {others.length === 0 ? (
              <p className="muted">Henüz başka esnaf yok. Arkadaşların dükkân açınca burada görünür.</p>
            ) : (
              <>
                <p className="muted" style={{ marginBottom: 8 }}>
                  Kime borçlusun?
                </p>
                <div className="merchant-list">
                  {others.map((m) => (
                    <button
                      key={m.id}
                      className={`merchant ${target?.id === m.id ? "on" : ""}`}
                      onClick={() => setTarget(m)}
                    >
                      <span>{merchantName(m.id)}</span>
                      <span className="muted">Sicil {m.sicil}</span>
                    </button>
                  ))}
                </div>
                <p className="muted" style={{ margin: "12px 0 8px" }}>
                  Ne kadar?
                </p>
                <div className="chips">
                  {DEBT_CHOICES.map((a) => (
                    <button key={a} className={`chip ${amount === a ? "on" : ""}`} onClick={() => setAmount(a)}>
                      {mon(a)} MON
                    </button>
                  ))}
                </div>
                <button
                  className="btn amber block"
                  style={{ marginTop: 14 }}
                  disabled={!target || !hasGas || !!busy}
                  onClick={writeDebt}
                >
                  {busy === "owe" ? (
                    <>
                      <span className="spinner" />
                      Yazılıyor…
                    </>
                  ) : target ? (
                    `${toward(merchantName(target.id))} ${mon(amount)} MON borç yaz`
                  ) : (
                    "Önce bir esnaf seç"
                  )}
                </button>
              </>
            )}
          </section>

          <section className="card">
            <h2>Net durumun</h2>
            <div className="debts">
              {mine.length === 0 && owedToMe.length === 0 && <p className="muted">Açık faturan yok.</p>}
              {mine.map((i, k) => (
                <div className="row" key={`d${k}`}>
                  <span>{toward(nameOf(i.creditor))} borcun</span>
                  <b className="mono">−{mon(i.amountWei)}</b>
                </div>
              ))}
              {owedToMe.map((i, k) => (
                <div className="row" key={`c${k}`}>
                  <span>{nameOf(i.debtor)} sana borçlu</span>
                  <b className="mono ok">+{mon(i.amountWei)}</b>
                </div>
              ))}
            </div>
            {(mine.length > 0 || owedToMe.length > 0) && (
              <>
                <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "12px 0" }} />
                <div className="row">
                  <span>Takasta ödeyeceğin nakit</span>
                  <b className="net mono">{monLabel(cashNeeded)}</b>
                </div>
                <p className="muted" style={{ marginTop: 4 }}>
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
        <section className="card result">
          <h2>Takas #{result.session} tamamlandı</h2>
          <div className="big mono">
            {result.delta >= 0n ? "+" : "−"}
            {mon(result.delta < 0n ? -result.delta : result.delta)} MON
          </div>
          <p style={{ marginTop: 6 }}>
            {result.closed > 0
              ? `${result.closed} borcun kapandı, sicilin arttı.`
              : result.stillOpen > 0
                ? "Teminatın yetmediği için faturaların bu turda dışarıda kaldı. Teminat ekleyip sonraki takasa katılabilirsin."
                : "Bu turda senin faturan yoktu."}
          </p>
          {result.last && (
            <p style={{ marginTop: 6 }}>
              Çarşıda {result.last.stats.invoices} fatura kapandı; {monLabel(result.last.stats.grossWei)} borç yerine yalnızca{" "}
              {monLabel(result.last.stats.cashWei)} nakit el değiştirdi.{" "}
              <a href={result.last.explorer} target="_blank" rel="noreferrer">
                İşlemi gör
              </a>
            </p>
          )}
          <button className="btn amber block" style={{ marginTop: 12 }} onClick={() => setResult(null)}>
            Tamam
          </button>
        </section>
      )}

      <p className="muted" style={{ fontSize: 12, textAlign: "center" }}>
        Kontrat:{" "}
        <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">
          {shortAddr(CONTRACT)}
        </a>
      </p>
    </div>
  );
}
