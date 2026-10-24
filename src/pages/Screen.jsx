import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { postJson, useBench, useTakasState } from "../lib/api.js";
import { EXPLORER, CONTRACT } from "../lib/chain.js";
import { monLabel, num, shortAddr } from "../lib/format.js";
import { companyName, initials } from "../lib/names.js";
import { Brand } from "./Brand.jsx";
import { Tag } from "./Tag.jsx";

const lc = (s) => (s || "").toLowerCase();
const toMon = (wei) => Number(wei) / 1e18;
const fmt = (n, d = 3) => n.toLocaleString("tr-TR", { maximumFractionDigits: d, minimumFractionDigits: 0 });

const FADE_MS = 2200; // oklar sönerken sayaç akarak düşer
const DONE_MS = 16000; // yeşil kart ekranda kalma süresi

/** Sayıyı hedef değere akıcı biçimde taşır. */
function useTween(target, ms = 900) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = a + (target - a) * e;
      setV(cur);
      from.current = cur;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function DebtGraph({ state, fading, quiet }) {
  const W = 840;
  const H = 560;
  const { nodes, edges, max } = useMemo(() => {
    const byAddr = new Map(state.members.map((m) => [lc(m.address), m]));
    const agg = new Map();
    for (const i of state.invoices) {
      const k = `${lc(i.debtor)}>${lc(i.creditor)}`;
      agg.set(k, (agg.get(k) || 0n) + BigInt(i.amountWei));
    }
    const ids = new Set();
    const e = [];
    for (const [k, v] of agg) {
      const [d, c] = k.split(">");
      const dm = byAddr.get(d);
      const cm = byAddr.get(c);
      if (!dm || !cm) continue;
      ids.add(dm.id);
      ids.add(cm.id);
      e.push({ d: dm.id, c: cm.id, v: Number(v) });
    }
    const list = [...ids].sort((a, b) => a - b).slice(0, 60);
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - 78;
    const pos = new Map(
      list.map((id, i) => {
        const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
        return [id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), a }];
      }),
    );
    return {
      nodes: list.map((id) => ({ id, ...pos.get(id) })),
      edges: e.filter((x) => pos.has(x.d) && pos.has(x.c)).map((x) => ({ ...x, p: pos.get(x.d), q: pos.get(x.c) })),
      max: Math.max(1, ...e.map((x) => x.v)),
    };
  }, [state]);

  if (nodes.length === 0) {
    return (
      <div className="empty-graph">
        {!quiet && <p className="muted">Henüz borç yok. Telefonundan şirketini kaydet, borç yaz.</p>}
      </div>
    );
  }
  const labels = nodes.length <= 24;
  return (
    <svg className="graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="İşletmeler arası borç ağı">
      <defs>
        <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#ff6b5b" />
        </marker>
      </defs>
      <g className={`edge ${fading ? "fading" : ""}`}>
        {edges.map((e, i) => {
          const dx = e.q.x - e.p.x;
          const dy = e.q.y - e.p.y;
          const len = Math.hypot(dx, dy) || 1;
          const sx = e.p.x + (dx / len) * 17;
          const sy = e.p.y + (dy / len) * 17;
          const ex = e.q.x - (dx / len) * 21;
          const ey = e.q.y - (dy / len) * 21;
          // hafif eğri: karşılıklı borçlar üst üste binmesin
          const mx = (sx + ex) / 2 - (dy / len) * 22;
          const my = (sy + ey) / 2 + (dx / len) * 22;
          return (
            <path
              key={i}
              d={`M${sx},${sy} Q${mx},${my} ${ex},${ey}`}
              fill="none"
              stroke="#ff6b5b"
              strokeOpacity="0.85"
              strokeWidth={1.4 + (e.v / max) * 4}
              markerEnd="url(#ah)"
            />
          );
        })}
      </g>
      {nodes.map((n) => {
        const cos = Math.cos(n.a);
        return (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={16} fill="#2f2948" stroke="#4a3f7a" strokeWidth="1.5" />
            <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#f4f1ff">
              {initials(n.id)}
            </text>
            {labels && (
              <text
                x={n.x + cos * 26}
                y={n.y + Math.sin(n.a) * 26 + 4}
                textAnchor={cos > 0.2 ? "start" : cos < -0.2 ? "end" : "middle"}
                fontSize="12"
                fill="#a39cc4"
              >
                {companyName(n.id)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Compare({ bench }) {
  const real = bench?.monad?.realSettle;
  const derived = bench?.ethereum?.derived;
  if (!real || !derived) return <p className="muted">Ölçüm sonuçları hazırlanıyor.</p>;
  const monMax = real.merchants;
  const ethMax = derived.maxMerchantsPerTx;
  const top = Math.max(monMax, ethMax, 1);
  return (
    <div className="compare">
      <div>
        <div className="row">
          <b>Monad testnet</b>
          <Tag kind={real.kind} />
        </div>
        <div className="row" style={{ marginTop: 4 }}>
          <span className="num">{num(monMax)} işletme · {num(real.invoices)} fatura</span>
          <a href={real.explorer} target="_blank" rel="noreferrer">
            işlem
          </a>
        </div>
        <div className="bar" style={{ width: `${(monMax / top) * 100}%` }} />
      </div>
      <div>
        <div className="row">
          <b>Ethereum kuralları</b>
          <Tag kind={derived.kind} />
        </div>
        <div className="row" style={{ marginTop: 4 }}>
          <span className="num">≈ {num(ethMax)} işletme / işlem</span>
        </div>
        <div className="bar eth" style={{ width: `${(ethMax / top) * 100}%` }} />
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        İşlem başı gas sınırı {num(bench.ethereum.txGasCap)} (EIP-7825); sınırı aşan boyutta gerçek settle() düştü.{" "}
        <a href="#/olcum">Ayrıntılar</a>
      </p>
    </div>
  );
}

/** Demo kontrolleri: demo ağını oluşturur ve takas yapar (gerçek Monad testnet işlemleri). */
function DemoPanel({ state, refresh }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);

  async function act(kind) {
    setBusy(kind);
    setMsg(null);
    try {
      const r = await postJson(kind === "seed" ? "/api/demo/seed" : "/api/demo/settle", {});
      setMsg(
        kind === "seed"
          ? { ok: true, text: `${r.merchantsAdded} işletme ve ${r.invoicesAdded} borç eklendi.`, links: r.txs.map((t, i) => [`İşlem ${i + 1}`, t.explorer]) }
          : { ok: true, text: "Takas işlemi onaylandı.", links: [["İşlemi gör", r.explorer]] },
      );
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy("");
    }
  }

  const full = state && state.invoiceCount + 20 > state.limits.maxOpenInvoices;
  return (
    <section className="card" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ marginBottom: 0 }}>Tek tıkla dene</h2>
      <p className="muted" style={{ fontSize: 14 }}>
        1. Demo ağını oluştur. 2. TAKAS'a bas ve borçların tek işlemde kapanmasını izle.
      </p>
      <button className="btn big block" disabled={!!busy || !state || full} onClick={() => act("seed")}>
        {busy === "seed" ? (
          <>
            <span className="spinner" />
            Oluşturuluyor…
          </>
        ) : (
          "Demo ağını oluştur"
        )}
      </button>
      <button
        className="btn big block"
        style={{ background: "var(--credit)", color: "var(--ink-on-green)" }}
        disabled={!!busy || !state || state.invoiceCount === 0}
        onClick={() => act("settle")}
      >
        {busy === "settle" ? (
          <>
            <span className="spinner" />
            Takas yapılıyor…
          </>
        ) : (
          "TAKAS"
        )}
      </button>
      {full && <p className="muted" style={{ fontSize: 13 }}>Ağda yeterince açık fatura var. Önce TAKAS'a bas.</p>}
      {msg && (
        <p className={msg.ok ? "ok" : "err"} style={{ fontSize: 14 }}>
          {msg.text}{" "}
          {msg.links?.map(([label, href]) => (
            <span key={href}>
              <a href={href} target="_blank" rel="noreferrer">
                {label}
              </a>{" "}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

export function ScreenView({ demo = false }) {
  const { state, error, refresh } = useTakasState(1500, demo ? "/api/demo/state" : "/api/state");
  const bench = useBench();
  const [qr, setQr] = useState("");
  const link = `${location.origin}/#/play`;

  const prev = useRef(null);
  const timers = useRef([]);
  const [phase, setPhase] = useState("idle"); // idle | fading | done
  const [dying, setDying] = useState(null);
  const [fadeOn, setFadeOn] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 560, color: { dark: "#120f1d", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [link]);

  // TAKAS anı: oklar söner, sayaç düşer, yeşil kart gelir.
  useEffect(() => {
    if (!state) return;
    const before = prev.current;
    prev.current = state;
    if (!before || state.session <= before.session || !state.lastSettle || state.lastSettle.stats.invoices === 0) return;
    const after = (ms, fn) => timers.current.push(setTimeout(fn, ms));
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setDying(before);
    setDone(null);
    setFadeOn(false);
    setPhase("fading");
    after(60, () => setFadeOn(true));
    after(FADE_MS, () => {
      setPhase("done");
      setDone(state.lastSettle);
    });
    after(FADE_MS + DONE_MS, () => {
      setPhase("idle");
      setDying(null);
      setDone(null);
    });
  }, [state]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const openTotal = state ? state.invoices.reduce((s, i) => s + Number(i.amountWei), 0) / 1e18 : 0;
  const cash = state ? toMon(state.preview.cashWei) : 0;
  const cumSaved = state ? toMon(BigInt(state.cumulative.grossWei) - BigInt(state.cumulative.cashWei)) : 0;
  const treasury = state ? toMon(state.feeBalanceWei) : 0;

  const tOpen = useTween(openTotal, FADE_MS);
  const tCash = useTween(cash, FADE_MS);
  const tSaved = useTween(cumSaved, 1400);
  const tTreasury = useTween(treasury, 1400);
  const last = state?.lastSettle;
  const graphState = phase === "fading" && dying ? dying : state;

  return (
    <div className="screen">
      <div className="topbar">
        <Brand />
        <nav className="links">
          {demo ? <a href="#/">Canlı ekran</a> : <a href="#/demo">Demo</a>}
          <a href="#/play">Telefon</a>
          <a href="#/host">Host</a>
          <a href="#/olcum">Ölçüm</a>
        </nav>
      </div>
      {demo && (
        <div className="demo-banner" role="note">
          Demo · sentetik işletmeler · gerçek Monad testnet işlemleri
        </div>
      )}

      <div className="screen-grid">
        <div className="col">
          {demo ? (
            <DemoPanel state={state} refresh={refresh} />
          ) : (
            <section className="card" style={{ textAlign: "center" }}>
              <h2>Katıl</h2>
              {qr ? <img className="qr" src={qr} alt="Katılmak için QR kodunu okut" /> : <div className="qr" style={{ aspectRatio: "1" }} />}
              <p style={{ marginTop: 10, fontWeight: 600 }}>Okut, şirketini kaydet</p>
              <p className="muted num" style={{ fontSize: 12, wordBreak: "break-all" }}>
                {link}
              </p>
              <a className="btn ghost block" style={{ marginTop: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }} href="#/demo">
                Tek tıkla dene: /#/demo
              </a>
            </section>
          )}
          <section className="card">
            <h2>Ağ</h2>
            <div className="stat-lines">
              <div className="row">
                <span className="muted">İşletme</span>
                <b className="num">{state ? num(state.memberCount) : "…"}</b>
              </div>
              <div className="row">
                <span className="muted">Açık fatura</span>
                <b className="num">{state ? num(state.invoiceCount) : "…"}</b>
              </div>
              <div className="row">
                <span className="muted">Yapılan takas</span>
                <b className="num">{state ? num(state.session) : "…"}</b>
              </div>
              <div className="row">
                <span className="muted">Ücret / fatura</span>
                <b className="num">{state ? monLabel(state.feeWei, 5) : "…"}</b>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Şirket adları kurgusaldır.
            </p>
          </section>
          <section className="card fact">
            <h2>Neden TAKAS?</h2>
            <div className="fact-num num debt">270 milyar TL</div>
            <p style={{ marginTop: 6 }}>karşılıksız çek</p>
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              2026 ilk 9 ay, TBB Risk Merkezi
            </p>
          </section>
        </div>

        <div className="col">
          {error && !state && <div className="card err">Bağlantı kurulamadı: {error}</div>}
          <div className="graph-wrap">
            {graphState ? <DebtGraph state={graphState} fading={phase === "fading" && fadeOn} quiet={phase !== "idle"} /> : <div className="empty-graph" />}
            {phase === "done" && done && (
              <div className="done-card" role="status">
                <h2>TAKAS TAMAM</h2>
                <div className="pair">
                  <div>
                    <small>İşletmelerin nakit tasarrufu</small>
                    <div className="n num">
                      {fmt(toMon(done.stats.savedWei))} <span className="unit">MON</span>
                    </div>
                  </div>
                  <div>
                    <small>TAKAS kazancı</small>
                    <div className="n num">
                      {fmt(toMon(done.stats.feesWei), 4)} <span className="unit">MON</span>
                    </div>
                  </div>
                </div>
                <p style={{ marginTop: 16, fontWeight: 500 }}>
                  {num(done.stats.invoices)} fatura, {num(done.stats.participants)} işletme: {monLabel(done.stats.grossWei)} borç yerine yalnızca{" "}
                  {monLabel(done.stats.cashWei)} nakit el değiştirdi.{" "}
                  <a href={done.explorer} target="_blank" rel="noreferrer">
                    İşlemi gör
                  </a>
                </p>
              </div>
            )}
          </div>
          <section className="card">
            <h2>Son takas</h2>
            {last ? (
              <div className="row" style={{ flexWrap: "wrap" }}>
                <b>Takas #{last.session}</b>
                <span className="num">
                  {num(last.stats.invoices)} fatura · {num(last.stats.participants)} işletme · {monLabel(last.stats.cashWei)} nakit
                </span>
                <a href={last.explorer} target="_blank" rel="noreferrer">
                  İşlemi gör
                </a>
              </div>
            ) : (
              <p className="muted">Henüz takas yapılmadı.</p>
            )}
          </section>
        </div>

        <div className="col">
          <div className="counter flow">
            <small>Borç → Gereken nakit</small>
            <div className="val num">
              <span className="debt">{fmt(tOpen)}</span>
              <span className="arrow">→</span>
              <span>{fmt(tCash)}</span>
              <span className="unit">MON</span>
            </div>
          </div>
          <div className="counter">
            <small>İşletmelerin nakit tasarrufu</small>
            <div className="val num credit">
              {fmt(tSaved)}
              <span className="unit">MON</span>
            </div>
          </div>
          <div className="counter">
            <small>TAKAS kazancı</small>
            <div className="val num" style={{ color: "var(--accent)" }}>
              {fmt(tTreasury, 4)}
              <span className="unit">MON</span>
            </div>
          </div>
          <section className="card">
            <h2>20.000 fatura, tek işlem</h2>
            <Compare bench={bench} />
          </section>
          <p className="muted" style={{ fontSize: 12 }}>
            Kontrat:{" "}
            <a href={`${EXPLORER}/address/${state?.contract ?? CONTRACT}`} target="_blank" rel="noreferrer" className="num">
              {shortAddr(state?.contract ?? CONTRACT)}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Screen() {
  return <ScreenView />;
}
