import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { getState, postJson, useBench, useTakasState } from "../lib/api.js";
import { EXPLORER, CONTRACT } from "../lib/chain.js";
import { monLabel, num, shortAddr } from "../lib/format.js";
import { companyName, initials } from "../lib/names.js";
import { Brand } from "./Brand.jsx";
import { Tag } from "./Tag.jsx";
import { Guilloche, Stamp } from "./Ornament.jsx";

const lc = (s) => (s || "").toLowerCase();
const toMon = (wei) => Number(wei) / 1e18;
const fmt = (n, d = 3) => n.toLocaleString("tr-TR", { maximumFractionDigits: d, minimumFractionDigits: 0 });

const FADE_MS = 2200; // oklar sönerken sayaç akarak düşer
const DONE_MS = 16000; // büyük ekranda yeşil kartın kalma süresi (demoda kart kalıcıdır)

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

function DebtGraph({ state, fading }) {
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
    const r = star ? Math.min(W, H) / 2 - 46 : Math.min(W, H) / 2 - 70;
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

  const labels = nodes.length <= 24;
  const tiny = star && nodes.length > 24; // çok sayıda alacaklı: küçük noktalar, rozetsiz
  return (
    <svg className="graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="İşletmeler arası borç ağı">
      <defs>
        <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#FF8A7A" />
        </marker>
      </defs>
      <g className={`edge ${fading ? "fading" : ""}`}>
        {edges.map((e, i) => {
          const dx = e.q.x - e.p.x;
          const dy = e.q.y - e.p.y;
          const len = Math.hypot(dx, dy) || 1;
          const from = star ? 28 : 19;
          const to = tiny ? 12 : 23;
          const sx = e.p.x + (dx / len) * from;
          const sy = e.p.y + (dy / len) * from;
          const ex = e.q.x - (dx / len) * to;
          const ey = e.q.y - (dy / len) * to;
          if (star) {
            return <line key={i} x1={sx} y1={sy} x2={ex} y2={ey} stroke="#FF8A7A" strokeOpacity="0.55" strokeWidth="1" markerEnd="url(#ah)" />;
          }
          // hafif eğri: karşılıklı borçlar üst üste binmesin
          const mx = (sx + ex) / 2 - (dy / len) * 22;
          const my = (sy + ey) / 2 + (dx / len) * 22;
          return (
            <path
              key={i}
              d={`M${sx},${sy} Q${mx},${my} ${ex},${ey}`}
              fill="none"
              stroke="#FF8A7A"
              strokeOpacity="0.8"
              strokeWidth={1 + (e.v / max) * 2.2}
              markerEnd="url(#ah)"
            />
          );
        })}
      </g>
      {nodes.map((n) => {
        const cos = Math.cos(n.a);
        return (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={n.hub ? 28 : tiny ? 7 : 18} fill="#102220" stroke="#9B8CFF" strokeWidth={n.hub ? 2 : 1.25} />
            {(n.hub || !tiny) && (
              <text x={n.x} y={n.y + 5} textAnchor="middle" fontSize={n.hub ? 15 : 13} fontWeight="600" fill="#EDF3EE">
                {n.badge}
              </text>
            )}
            {n.hub && (
              <text x={n.x} y={n.y + 50} textAnchor="middle" fontSize="15" fill="#93A8A2">
                {n.name}
              </text>
            )}
            {labels && !n.hub && (
              <text
                x={n.x + cos * 28}
                y={n.y + Math.sin(n.a) * 28 + 5}
                textAnchor={cos > 0.2 ? "start" : cos < -0.2 ? "end" : "middle"}
                fontSize="15"
                fill="#93A8A2"
              >
                {n.name}
              </text>
            )}
          </g>
        );
      })}
      {tiny && (
        <text x={W / 2} y={H - 8} textAnchor="middle" fontSize="15" fill="#93A8A2">
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
      <p className="muted small">
        İşlem başı sınır {num(bench.ethereum.txGasCap)} gas (EIP-7825). <a href="#/olcum">Ayrıntılar</a>
      </p>
    </div>
  );
}

/** Boş durum: ağ boşken ana alanı "Nasıl çalışır" anlatımı ve katılım için doldurur. */
function HowItWorks({ qr, link, demo }) {
  return (
    <div className="howto card">
      <div className="howto-text">
        <h2 className="howto-title">{demo ? "Soldan bir senaryo seç" : "Nasıl çalışır"}</h2>
        <ol className="howto-steps">
          <li>
            <b>Şirketini kaydet.</b> <span className="muted">Teminat yatır.</span>
          </li>
          <li>
            <b>Borcunu yaz.</b> <span className="muted">Borçlu kendi borcunu yazar.</span>
          </li>
          <li>
            <b>TAKAS.</b> <span className="muted">Herkes sadece net borcunu öder; teminatı yetmeyen sonraki tura kalır.</span>
          </li>
        </ol>
        {demo && <p className="muted">Senaryo seçince zincire sentetik işletmeler ve borçlar yazılır; ağ birkaç saniyede burada belirir.</p>}
      </div>
      {!demo && (
        <div className="howto-qr">
          {qr ? <img className="qr" src={qr} alt="Katılmak için QR kodunu okut" /> : <div className="qr" style={{ aspectRatio: "1" }} />}
          <p className="howto-qr-cap">Telefonla okut, şirketini kaydet</p>
          <p className="muted num small">{link}</p>
        </div>
      )}
    </div>
  );
}

/** Yeşil sonuç kartı. Demoda "Yeniden kur" ile aynı senaryo baştan kurulur. */
function ResultCard({ result, onRebuild, busy, overlay }) {
  const s = result.stats;
  return (
    <div className={`done-card ${overlay ? "overlay" : ""}`} role="status">
      <Guilloche lines={18} />
      <Stamp />
      <h2>Takas tamam</h2>
      {result.scenario === "payroll" ? (
        <>
          <div className="done-headline num">{num(s.invoices)} maaş tek işlemde ödendi</div>
          <div className="pair">
            <div>
              <small>Toplam ödenen tutar</small>
              <div className="n num">
                {fmt(toMon(s.grossWei))} <span className="unit">MON</span>
              </div>
            </div>
            <div>
              <small>Kullanılan gas</small>
              <div className="n num">{num(s.gasUsed)}</div>
            </div>
          </div>
          <p className="done-line">
            {num(s.participants)} hesap, tek settle() işlemi. TAKAS kazancı {monLabel(s.feesWei, 4)}.{" "}
            <a href={result.explorer} target="_blank" rel="noreferrer">
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
                {fmt(toMon(s.savedWei))} <span className="unit">MON</span>
              </div>
            </div>
            <div>
              <small>TAKAS kazancı</small>
              <div className="n num">
                {fmt(toMon(s.feesWei), 4)} <span className="unit">MON</span>
              </div>
            </div>
          </div>
          <p className="done-line">
            {num(s.invoices)} fatura, {num(s.participants)} işletme: {monLabel(s.grossWei)} borç yerine yalnızca {monLabel(s.cashWei)} nakit el
            değiştirdi.{" "}
            <a href={result.explorer} target="_blank" rel="noreferrer">
              İşlemi gör
            </a>
          </p>
        </>
      )}
      {onRebuild && (
        <button className="btn done-btn" disabled={busy} onClick={onRebuild}>
          {busy ? (
            <>
              <span className="spinner" />
              Kuruluyor…
            </>
          ) : (
            "Yeniden kur"
          )}
        </button>
      )}
    </div>
  );
}

const SCENARIOS = [
  ["supply", "Tedarik zinciri", "10 şirket, 20 borç"],
  ["payroll", "Maaş günü", "1 şirket, 200 çalışan"],
];

/** Demo kontrolleri: her adımın üstünde ne olacağı yazar. Hepsi gerçek Monad testnet işlemi. */
function DemoPanel({ state, scenario, busy, msg, onPick, onSettle }) {
  return (
    <section className="card demo-panel">
      <p className="demo-step">
        <span className="step-dot num">1</span> Senaryo seç → zincire gerçek işletmeler ve borçlar yazılır
      </p>
      {SCENARIOS.map(([key, title, sub]) => (
        <button key={key} className={`scenario ${scenario === key ? "on" : ""}`} disabled={!!busy} onClick={() => onPick(key)}>
          <b>{busy === `seed:${key}` ? "Kuruluyor…" : title}</b>
          <span className="muted">{sub}</span>
        </button>
      ))}
      <p className="demo-step">
        <span className="step-dot num">2</span> TAKAS'a bas → tek işlemde netleşir
      </p>
      <button className="btn big block takas-btn" disabled={!!busy || !state || state.invoiceCount === 0} onClick={onSettle}>
        {busy === "settle" ? (
          <>
            <span className="spinner" />
            Takas yapılıyor…
          </>
        ) : (
          "TAKAS"
        )}
      </button>
      <p className="demo-step">
        <span className="step-dot num">3</span> Sonuç
      </p>
      {msg ? (
        <p className={msg.ok ? "ok small" : "err small"}>
          {msg.text}{" "}
          {msg.links?.map(([label, href]) => (
            <span key={href}>
              <a href={href} target="_blank" rel="noreferrer">
                {label}
              </a>{" "}
            </span>
          ))}
        </p>
      ) : (
        <p className="muted small">Takastan sonra sonuç kartı ortada kalır.</p>
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

  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 560, color: { dark: "#0b1715", light: "#ffffff" } })
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
    if (!demo) {
      after(FADE_MS + DONE_MS, () => {
        setPhase("idle");
        setDying(null);
        setDone(null);
      });
    }
  }, [state, demo]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // ---- demo işlemleri ----
  async function pick(next) {
    setScenario(next);
    setMsg(null);
    setBusy(`seed:${next}`);
    try {
      // Seçilen ağda açık fatura yoksa senaryo kurulur; varsa yalnızca o ağa geçilir.
      const path = `/api/demo/state?scenario=${next}`;
      const st = await getState(path).catch(() => getState(path));
      if (st.invoiceCount > 0) {
        setMsg({ ok: true, text: "Ağ hazır. TAKAS'a bas." });
      } else {
        const r = await postJson("/api/demo/seed", { scenario: next });
        setPhase("idle");
        setDone(null);
        setDying(null);
        setMsg({
          ok: true,
          text:
            next === "payroll"
              ? `1 şirket ve ${r.workersAdded} çalışan eklendi, ${r.invoicesAdded} maaş faturası yazıldı.`
              : `${r.merchantsAdded} işletme ve ${r.invoicesAdded} borç eklendi.`,
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

  const openTotal = state ? state.invoices.reduce((s, i) => s + Number(i.amountWei), 0) / 1e18 : 0;
  const cash = state ? toMon(state.preview.cashWei) : 0;
  const cumSaved = state ? toMon(BigInt(state.cumulative.grossWei) - BigInt(state.cumulative.cashWei)) : 0;
  const treasury = state ? toMon(state.feeBalanceWei) : 0;

  const tOpen = useTween(openTotal, FADE_MS);
  const tCash = useTween(cash, FADE_MS);
  const tSaved = useTween(cumSaved, 1400);
  const tTreasury = useTween(treasury, 1400);
  const last = state?.lastSettle;
  const hasOpen = !!state && state.invoices.length > 0;

  // ---- orta alan: ağ, sonuç kartı ya da anlatım; boş kutu yok ----
  let center;
  if (!state) {
    center = <div className="howto card muted">{error ? `Bağlantı kurulamadı: ${error}` : "Yükleniyor…"}</div>;
  } else if (phase === "fading" && dying) {
    center = <DebtGraph state={dying} fading={fadeOn} />;
  } else if (phase === "done" && done && !(demo && hasOpen)) {
    center = (
      <div className="stage">
        {dying && <DebtGraph state={dying} fading />}
        <ResultCard result={done} overlay={!!dying} onRebuild={demo ? () => pick(scenario) : null} busy={busy.startsWith("seed")} />
      </div>
    );
  } else if (hasOpen) {
    center = <DebtGraph state={state} />;
  } else if (demo && last) {
    center = (
      <div className="stage">
        <ResultCard result={{ ...last, scenario: state.scenario }} onRebuild={() => pick(scenario)} busy={busy.startsWith("seed")} />
      </div>
    );
  } else {
    center = <HowItWorks qr={qr} link={link} demo={demo} />;
  }

  const showSideQr = !demo && (hasOpen || phase !== "idle");
  const contract = state?.contract ?? CONTRACT;

  return (
    <div className="screen">
      <div className="topbar">
        <Brand />
        <nav className="links">
          <a href="#/">Tanıtım</a>
          {demo ? <a href="#/ekran">Ekran</a> : <a href="#/demo">Demo</a>}
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
          {demo && <DemoPanel state={state} scenario={scenario} busy={busy} msg={msg} onPick={pick} onSettle={settle} />}
          {showSideQr && (
            <section className="card side-qr">
              {qr ? <img className="qr" src={qr} alt="Katılmak için QR kodunu okut" /> : <div className="qr" style={{ aspectRatio: "1" }} />}
              <p>
                <b>Katıl:</b> okut, şirketini kaydet
              </p>
            </section>
          )}
          <section className="card stats-card">
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
          </section>
          {!demo && (
            <section className="card fact">
              <div className="fact-num num debt">270 milyar TL</div>
              <p>karşılıksız çek</p>
              <p className="muted small">2026 ilk 9 ay, TBB Risk Merkezi</p>
            </section>
          )}
        </div>

        <div className="col center-col">
          <div className="center">{center}</div>
          <section className="card last-line">
            {last ? (
              <div className="row" style={{ flexWrap: "wrap" }}>
                <b>Son takas #{last.session}</b>
                <span className="num">
                  {num(last.stats.invoices)} fatura · {num(last.stats.participants)} işletme · {monLabel(last.stats.cashWei)} nakit
                </span>
                <a href={last.explorer} target="_blank" rel="noreferrer">
                  İşlemi gör
                </a>
              </div>
            ) : (
              <span className="muted">Henüz takas yapılmadı.</span>
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
          <p className="muted small">
            {demo ? "Demo kontratı" : "Kontrat"}:{" "}
            <a href={`${EXPLORER}/address/${contract}`} target="_blank" rel="noreferrer" className="num">
              {shortAddr(contract)}
            </a>{" "}
            · şirket adları kurgusaldır
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Screen() {
  return <ScreenView />;
}
