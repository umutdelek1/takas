// İşletme kimlikleri hesap numarasından üretilir: soyad + sektör + şirket türü. Tüm adlar kurgusaldır.

const SURNAMES = [
  "Kaya",
  "Demir",
  "Yıldız",
  "Çelik",
  "Aydın",
  "Öztürk",
  "Arslan",
  "Doğan",
  "Aslan",
  "Kurt",
  "Özdemir",
  "Şahin",
  "Koç",
  "Polat",
  "Erdem",
  "Güneş",
  "Acar",
  "Taş",
  "Bulut",
];

const SECTORS = [
  "Un San.",
  "Lojistik Ltd.",
  "Tekstil A.Ş.",
  "Gıda San.",
  "Ambalaj Ltd.",
  "Metal San.",
  "Plastik Ltd.",
  "Boya A.Ş.",
  "Nakliyat Ltd.",
  "Mobilya San.",
  "Kimya A.Ş.",
  "Elektrik Ltd.",
];

const TOTAL = SURNAMES.length * SECTORS.length; // 19 ve 12 aralarında asal: 228 benzersiz ad

/** Şirket adı: "Kaya Un San.", "Demir Lojistik Ltd."; 228'den sonrası numaralanır. */
export function companyName(id) {
  const base = `${SURNAMES[id % SURNAMES.length]} ${SECTORS[id % SECTORS.length]}`;
  return id < TOTAL ? base : `${base} ${Math.floor(id / TOTAL) + 1}`;
}

/** Rozet baş harfleri: "Kaya Un San." → "KU". */
export function initials(id) {
  const [surname, sector] = companyName(id).split(" ");
  return `${surname[0]}${sector[0]}`.toLocaleUpperCase("tr-TR");
}
