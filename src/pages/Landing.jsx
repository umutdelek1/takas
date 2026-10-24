import { useEffect, useRef, useState } from "react";
import { useBench } from "../lib/api.js";
import { EXPLORER } from "../lib/chain.js";
import { num, shortAddr } from "../lib/format.js";
import deployment from "../deployment.js";
import { Brand } from "./Brand.jsx";
import { Tag } from "./Tag.jsx";
import { Guilloche, Stamp } from "./Ornament.jsx";

const GITHUB = "https://github.com/umutdelek1/takas";

// Varsayımsal örnek: Kaya Un → Demir Lojistik → Ege Tekstil → Kaya Un.
// Brüt 230 MON; netleşince yalnızca Kaya Un 40 MON öder (Demir'e 30, Ege'ye 10).
const NODES = {
  KU: { x: 210, y: 70, name: "Kaya Un San." },
  DL: { x: 330, y: 300, name: "Demir Lojistik Ltd." },
  ET: { x: 90, y: 300, name: "Ege Tekstil A.Ş." },
};
const DEBTS = [
  ["KU", "DL", 100],
  ["DL", "ET", 70],
  ["ET", "KU", 60],
];
const NETS = [
  ["KU", "DL", 30],
  ["KU", "ET", 10],
];
const CYCLE = 9000; // ms: borçlar → TAKAS → net ödemeler → baştan

function arrow(a, b, bend, inset = 34) {
  const p = NODES[a];
  const q = NODES[b];
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy);
  const sx = p.x + (dx / len) * inset;
  const sy = p.y + (dy / len) * inset;
  const ex = q.x - (dx / len) * (inset + 4);
  const ey = q.y - (dy / len) * (inset + 4);
  const mx = (sx + ex) / 2 - (dy / len) * bend;
  const my = (sy + ey) / 2 + (dx / len) * bend;
  const off = bend + Math.sign(bend) * 22; // etiket eğrinin dış tarafında
  return { d: `M${sx},${sy} Q${mx},${my} ${ex},${ey}`, lx: (sx + ex) / 2 - (dy / len) * off, ly: (sy + ey) / 2 + (dx / len) * off + 5 };
}

/** Kendi kendine dönen örnek: oklar söner, sayaç 230'dan 40'a akar. */
function LoopExample() {
  const [t, setT] = useState(0);
  const start = useRef(performance.now());
  useEffect(() => {
    let raf;
    const tick = (now) => {
      setT((now - start.current) % CYCLE);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const settling = t > 3200; // TAKAS anı
  const k = Math.min(1, Math.max(0, (t - 3400) / 1600));
  const ease = 1 - Math.pow(1 - k, 3);
  const value = Math.round(230 - (230 - 40) * ease);
  const showNet = t > 5000;

  return (
    <div className="loop">
      <Stamp />
      <svg viewBox="0 0 420 370" role="img" aria-label="Üç şirketlik borç döngüsünün takası">
        <defs>
          <marker id="lah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#FF8A7A" />
          </marker>
          <marker id="lahg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#6EE7B7" />
          </marker>
        </defs>
        <g style={{ opacity: settling ? 0 : 1, transition: "opacity 1.2s ease" }}>
          {DEBTS.map(([a, b, v]) => {
            const r = arrow(a, b, -26);
            return (
              <g key={a + b}>
                <path d={r.d} fill="none" stroke="#FF8A7A" strokeWidth={1.2 + v / 50} markerEnd="url(#lah)" />
                <text x={r.lx} y={r.ly} textAnchor="middle" className="loop-amt debt">
                  {v}
                </text>
              </g>
            );
          })}
        </g>
        <g style={{ opacity: showNet ? 1 : 0, transition: "opacity 0.8s ease" }}>
          {NETS.map(([a, b, v]) => {
            const r = arrow(a, b, 18);
            return (
              <g key={a + b}>
                <path d={r.d} fill="none" stroke="#6EE7B7" strokeWidth="1.8" strokeDasharray="6 5" markerEnd="url(#lahg)" />
                <text x={r.lx} y={r.ly} textAnchor="middle" className="loop-amt credit">
                  {v}
                </text>
              </g>
            );
          })}
        </g>
        {Object.entries(NODES).map(([id, n]) => (
          <g key={id}>
            <circle cx={n.x} cy={n.y} r="28" fill="#102220" stroke="#9B8CFF" strokeWidth="1.5" />
            <text x={n.x} y={n.y + 6} textAnchor="middle" fontSize="16" fontWeight="600" fill="#EDF3EE">
              {id}
            </text>
            <text x={n.x} y={n.y + (n.y < 150 ? -40 : 50)} textAnchor="middle" fontSize="14" fill="#93A8A2">
              {n.name}
            </text>
          </g>
        ))}
      </svg>
      <div className="loop-counter">
        <div className={`loop-stage ${settling ? "on" : ""}`}>{settling ? "TAKAS" : "Açık borçlar"}</div>
        <div className="loop-value num">
          <span className={settling ? "credit" : "debt"}>{value}</span> MON
        </div>
        <div className="muted">{showNet ? "230 MON borç → 40 MON nakit" : "230 MON brüt borç"}</div>
      </div>
      <p className="muted loop-note">Varsayımsal örnek</p>
    </div>
  );
}

function Bignum({ value, label, kind, children }) {
  return (
    <div className="bignum card">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="bignum-value num">{value}</div>
        <Tag kind={kind} />
      </div>
      <p className="bignum-label">{label}</p>
      {children}
    </div>
  );
}

export default function Landing() {
  const bench = useBench();
  const real = bench?.monad?.realSettle;
  const derived = bench?.ethereum?.derived;
  const contracts = [
    ["Takas (canlı)", deployment.takas],
    ["Demo: tedarik zinciri", deployment.demo],
    ["Demo: maaş günü", deployment.demoPayroll],
    ["TakasStress (ölçüm)", bench?.monad?.contract],
  ].filter(([, a]) => a);

  return (
    <div className="landing">
      <header className="topbar landing-nav">
        <Brand />
        <nav className="links">
          <a href="#/demo">Demo</a>
          <a href="#/ekran">Ekran</a>
          <a href="#/play">Telefon</a>
          <a href="#/olcum">Ölçüm</a>
        </nav>
      </header>

      <section className="hero">
        <Guilloche />
        <div className="hero-text">
          <p className="eyebrow">Monad testnet · çok taraflı borç takası</p>
          <h1>Birbirine borçlu işletmeler, tek işlemde ödeşir.</h1>
          <p className="lead">
            TAKAS, KOBİ'lerin ve tedarik zincirlerinin karşılıklı borçlarını Monad üzerinde tek bir atomik işlemde netleştirir. Herkes sadece farkı
            öder.
          </p>
          <div className="hero-cta">
            <a className="btn big" href="#/demo">
              Canlı demoyu dene
            </a>
            <a className="btn big ghost" href="#/play">
              Telefondan katıl
            </a>
          </div>
        </div>
        <LoopExample />
      </section>

      <section className="band">
        <div className="band-num num debt">270 milyar TL</div>
        <div>
          <p className="band-title">karşılıksız çek</p>
          <p className="muted">2026 ilk 9 ay, TBB Risk Merkezi. Bir kısmı nakit sıkışıklığından: herkes alacaklı, ama herkes nakit arıyor.</p>
        </div>
      </section>

      <section className="block">
        <h2 className="block-title">Nasıl çalışır</h2>
        <div className="steps">
          <div className="card step">
            <span className="step-no num">1</span>
            <h3>Şirketini kaydet</h3>
            <p className="muted">İşletme kayıt olur ve teminat yatırır.</p>
          </div>
          <div className="card step">
            <span className="step-no num">2</span>
            <h3>Borcunu yaz</h3>
            <p className="muted">Borçlu kendi borcunu yazar; kimse başkası adına fatura kesemez.</p>
          </div>
          <div className="card step">
            <span className="step-no num">3</span>
            <h3>TAKAS</h3>
            <p className="muted">Tüm faturalar tek işlemde netleşir: herkes sadece net borcunu öder, teminatı yetmeyen sonraki tura kalır.</p>
          </div>
        </div>
      </section>

      <section className="block">
        <h2 className="block-title">Neden Monad</h2>
        <div className="versus">
          <Bignum value={real ? `${num(real.invoices)} fatura` : "20.000 fatura"} label="Monad testnet: tek işlem, 10.000 işletme" kind={real?.kind ?? "ölçülen"}>
            {real && (
              <a href={real.explorer} target="_blank" rel="noreferrer">
                İşlemi explorer'da gör
              </a>
            )}
          </Bignum>
          <Bignum
            value={derived ? `≈ ${num(derived.maxMerchantsPerTx)}` : "≈ 2.421"}
            label="Ethereum kurallarında işletme sınırı (işlem başı 16.777.216 gas, EIP-7825); 2.500 işletmede gerçek işlem düştü"
            kind={derived?.kind ?? "hesaplanan"}
          />
        </div>
        <p className="muted block-note">
          Hesaplar ve faturalar slot başına iki kayıt olacak şekilde yan yana tutulur; Monad'ın MIP-8 sayfa bazlı depolama fiyatlandırmasında aynı
          sayfadaki erişimler ucuzdur. <a href="#/olcum">Ölçüm ayrıntıları</a>
        </p>
      </section>

      <section className="block">
        <h2 className="block-title">Kazan-kazan</h2>
        <div className="steps two">
          <div className="card step">
            <h3 className="credit">İşletme kazanır</h3>
            <p className="muted">Karşılıklı borçlar netleşir; nakit ihtiyacı ve karşılıksız çek riski düşer.</p>
          </div>
          <div className="card step">
            <h3 style={{ color: "var(--accent)" }}>TAKAS kazanır</h3>
            <p className="muted">Takasta kapanan her fatura için küçük, sabit bir ücret alır; yalnızca işletmeye kazandırdığından pay alır.</p>
          </div>
        </div>
        <div className="uses">
          <div className="card">
            <h3>Tedarik zinciri</h3>
            <p className="muted">Zincirdeki şirketler dönem sonunda ödeşir, yalnızca fark nakit olarak hareket eder.</p>
          </div>
          <div className="card">
            <h3>Toplu maaş ve hakediş</h3>
            <p className="muted">
              Yüzlerce ödeme tek işlemde. <a href="#/demo">Demoda "Maaş günü" senaryosu</a>
            </p>
          </div>
        </div>
      </section>

      <section className="cta-strip">
        <h2>Kendin dene: senaryoyu seç, TAKAS'a bas.</h2>
        <a className="btn big" href="#/demo">
          Canlı demoyu dene
        </a>
      </section>

      <footer className="footer">
        <div>
          <Brand />
          <p className="muted" style={{ marginTop: 10 }}>
            Monad testnet · şirket adları kurgusaldır
          </p>
          <p style={{ marginTop: 8 }}>
            <a href={GITHUB} target="_blank" rel="noreferrer">
              GitHub: umutdelek1/takas
            </a>
          </p>
        </div>
        <div className="footer-contracts">
          {contracts.map(([label, a]) => (
            <div className="row" key={label}>
              <span className="muted">{label}</span>
              <a className="num" href={`${EXPLORER}/address/${a}`} target="_blank" rel="noreferrer">
                {shortAddr(a)}
              </a>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
