export function Logo({ size = 34 }) {
  return (
    <span className="logo" style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width={size * 0.7} height={size * 0.7} fill="none" stroke="#f2a541" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 11h18M7 21h18M21 7l4 4-4 4M11 17l-4 4 4 4" />
      </svg>
    </span>
  );
}

export function Brand() {
  return (
    <a className="brand" href="#/" style={{ color: "inherit", textDecoration: "none" }}>
      <Logo />
      TAKAS
    </a>
  );
}
