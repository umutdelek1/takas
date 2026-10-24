import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { getState, postJson, useBench, useTakasState } from "../lib/api.js";
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
  const { nodes, edges, max, star, total } = useMemo(() => {
    const byAddr = new Map(state.members.map((m) => [lc(m.address), m]));
    const byId = new Map(state.members.map((m) => [m.id, m]));
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
    // Yıldız düzeni (maaş günü): tüm faturalar tek borçludan çıkıyorsa borçlu ortada, alacaklılar halkada.
    const outDeg = new Map();
    for (const x of e) outDeg.set(x.d, (outDeg.get(x.d) || 0) + 1);
    const hub = [...outDeg].find(([, n]) => n === e.length && e.length >= 8)?.[0];
    const star = hub !== undefined;
    const sorted = [...ids].sort((a, b) => a - b);
    const list = star ? [hub, ...sorted.filter((id) => id !== hub).slice(0, 59)] : sorted.slice(0, 60);
    const cx = W / 2;
    const cy = H / 2;
    const r = star ? Math.min(W, H) / 2 - 46 : Math.min(W, H) / 2 - 78;
    const ring = star ? list.slice(1) : list;
    const pos = new Map(
      ring.map((id, i) => {
        const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
        return [id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), a }];
      }),
    );
    if (star) pos.set(hub, { x: cx, y: cy, a: 0, hub: true });
    return {
      nodes: list.map((id) => {
        const m = byId.get(id);
        return { id, name: m?.name ?? companyName(id), badge: m?.badge ?? initials(id), ...pos.get(id) };
      }),
      edges: e.filter((x) => pos.has(x.d) && pos.has(x.c)).map((x) => ({ ...x, p: pos.get(x.d), q: pos.get(x.c) })),
      max: Math.max(1, ...e.map((x) => x.v)),
      star,
      total: e.length,
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
  const tiny = star && nodes.length > 24; // çok sayıda alacaklı: küçük noktalar, rozetsiz
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
          const from = star ? 28 : 17;
          const to = tiny ? 12 : 21;
          const sx = e.p.x + (dx / len) * from;
          const sy = e.p.y + (dy / len) * from;
          const ex = e.q.x - (dx / len) * to;
          const ey = e.q.y - (dy / len) * to;
          if (star) {
            return (
              <line key={i} x1={sx} y1={sy} x2={ex} y2={ey} stroke="#ff6b5b" strokeOpacity="0.7" strokeWidth="1.4" markerEnd="url(#ah)" />
            );
          }
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
            <circle cx={n.x} cy={n.y} r={n.hub ? 26 : tiny ? 7 : 16} fill={n.hub ? "#7a62f5" : "#2f2948"} stroke="#4a3f7a" strokeWidth="1.5" />
            {(n.hub || !tiny) && (
              <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={n.hub ? 14 : 11} fontWeight="700" fill="#f4f1ff">
                {n.badge}
              </text>
            )}
            {n.hub && (
              <text x={n.x} y={n.y + 46} textAnchor="middle" fontSize="12" fill="#a39cc4">
                {n.name}
              </text>
            )}
            {labels && !n.hub && (
              <text
                x={n.x + cos * 26}
                y={n.y + Math.sin(n.a) * 26 + 4}
                textAnchor={cos > 0.2 ? "start" : cos < -0.2 ? "end" : "middle"}
                fontSize="12"
                fill="#a39cc4"
              >
                {n.name}
              </text>
            )}
          </g>
        );
      })}
      {tiny && (
        <text x={W / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="#a39cc4">
          {total} maaş faturası · ilk {nodes.length - 1} çalışan gösteriliyor
        </text>
      )}
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

/** Demo kontrolleri: iki senaryo (tedarik zinciri, maaş günü) ve TAKAS. Hepsi gerçek Monad testnet işlemi. */
function DemoPanel({ state, refresh, scenario, setScenario }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);

  async function pick(next) {
    setScenario(next);
    setMsg(null);
    setBusy(`seed:${next}`);
    try {
      // Seçilen ağda açık fatura yoksa senaryo kurulur; varsa yalnızca o ağa geçilir.
      const st = await getState(`/api/demo/state?scenario=${next}`).catch(() => getState(`/api/demo/state?scenario=${next}`));
      if (st.invoiceCount > 0) {
        setMsg({ ok: true, text: "Ağ hazır. TAKAS'a bas." });
      } else {
        const r = await postJson("/api/demo/seed", { scenario: next });
        setMsg({
          ok: true,
          text: next === "payroll" ? `1 şirket ve ${r.workersAdded} çalışan eklendi, ${r.invoicesAdded} maaş faturası yazıldı.` : `${r.merchantsAdded} işletme ve ${r.invoicesAdded} borç eklendi.`,
          links: r.txs.map((t, i) => [r.txs.length > 1 ? `İşlem ${i + 1}` : "İşlemi gör", t.explorer]),
        });
      }
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy("");
    }
  }

  async function settle() {
    setBusy("settle");
    setMsg(null);
    try {
      const r = await postJson("/api/demo/settle", { scenario });
      setMsg({ ok: true, text: "Takas işlemi onaylandı.", links: [["İşlemi gör", r.explorer]] });
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy("");
    }
  }

  const scenarios = [
    ["supply", "Tedarik zinciri", "10 şirket, 20 borç"],
    ["payroll", "Maaş günü", "1 şirket, 200 çalışan"],
  ];
  return (
    <section className="card" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ marginBottom: 0 }}>Tek tıkla dene</h2>
      <p className="muted" style={{ fontSize: 14 }}>
        1. Bir senaryo seç. 2. TAKAS'a bas ve borçların tek işlemde kapanmasını izle.
      </p>
      {scenarios.map(([key, title, sub]) => (
        <button
          key={key}
          className={`scenario ${scenario === key ? "on" : ""}`}
          disabled={!!busy}
          onClick={() => pick(key)}
        >
          <b>{busy === `seed:${key}` ? "Hazırlanıyor…" : title}</b>
          <span className="muted">{sub}</span>
        </button>
      ))}
      <button
        className="btn big block"
        style={{ background: "var(--credit)", color: "var(--ink-on-green)" }}
        disabled={!!busy || !state || state.invoiceCount === 0}
        onClick={settle}
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
  const [scenario, setScenario] = useState("supply");
  const { state, error, refresh } = useTakasState(1500, demo ? `/api/demo/state?scenario=${scenario}` : "/api/state");
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
    if (before && before.contract !== state.contract) {
      // Senaryo değişti: önceki senaryonun animasyonu ve kartı kapanır.
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setPhase("idle");
      setDying(null);
      setDone(null);
      return;
    }
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
      setDone({ ...state.lastSettle, scenario: state.scenario });
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
            <DemoPanel state={state} refresh={refresh} scenario={scenario} setScenario={setScenario} />
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
                {done.scenario === "payroll" ? (
                  <>
                    <div className="n num" style={{ marginBottom: 16, fontSize: 30, whiteSpace: "normal" }}>
                      {num(done.stats.invoices)} maaş tek işlemde ödendi
                    </div>
                    <div className="pair">
                      <div>
                        <small>Toplam ödenen tutar</small>
                        <div className="n num">
                          {fmt(toMon(done.stats.grossWei))} <span className="unit">MON</span>
                        </div>
                      </div>
                      <div>
                        <small>Kullanılan gas</small>
                        <div className="n num">{num(done.stats.gasUsed)}</div>
                      </div>
                    </div>
                    <p style={{ marginTop: 16, fontWeight: 500 }}>
                      {num(done.stats.participants)} hesap, tek settle() işlemi. TAKAS kazancı {monLabel(done.stats.feesWei, 4)}.{" "}
                      <a href={done.explorer} target="_blank" rel="noreferrer">
                        İşlemi gör
                      </a>
                    </p>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>            )}
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
