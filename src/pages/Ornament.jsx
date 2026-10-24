import { useId, useMemo } from "react";

/**
 * Çek ve banknotlardaki güvenlik baskısından (gilyoş) ince dalga deseni.
 * Renk `currentColor`'dan gelir; yoğunluk CSS ile ayarlanır.
 */
export function Guilloche({ className = "", lines = 26, width = 1200, height = 600 }) {
  const paths = useMemo(() => {
    const out = [];
    for (let i = 0; i < lines; i++) {
      const base = height / 2 + (i - lines / 2) * (height / lines) * 0.9;
      let d = "";
      for (let x = 0; x <= width; x += 8) {
        const y = base + 38 * Math.sin(x / 95 + i * 0.32) + 16 * Math.sin(x / 41 - i * 0.55);
        d += `${x === 0 ? "M" : "L"}${x},${y.toFixed(1)}`;
      }
      out.push(d);
    }
    return out;
  }, [lines, width, height]);
  return (
    <svg className={`guilloche ${className}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="0.7" />
      ))}
    </svg>
  );
}

/** Takas odası kaşesi: çift halka, çevresinde yazı, ortada TAKAS. */
export function Stamp({ className = "", ring = "TAKAS ODASI • MONAD TESTNET • ", center = "TAKAS" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={`stamp ${className}`} viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <path id={`arc${id}`} d="M100,100 m-70,0 a70,70 0 1,1 140,0 a70,70 0 1,1 -140,0" />
      </defs>
      <circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" strokeWidth="4" />
      <circle cx="100" cy="100" r="84" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="100" cy="100" r="54" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <text fontSize="14.5" fontWeight="600" letterSpacing="2.4" fill="currentColor">
        <textPath href={`#arc${id}`}>{ring + ring}</textPath>
      </text>
      <text x="100" y="110" textAnchor="middle" fontSize="27" fontWeight="700" letterSpacing="2" fill="currentColor">
        {center}
      </text>
    </svg>
  );
}
