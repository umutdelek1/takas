// bench.json'daki kaynak etiketlerini görünür kılar: ölçülen / tahmin / hesaplanan.
const CLASS = { ölçülen: "measured", tahmin: "estimate", hesaplanan: "computed" };

export function Tag({ kind }) {
  if (!kind) return null;
  return <span className={`tag ${CLASS[kind] ?? ""}`}>{kind}</span>;
}
