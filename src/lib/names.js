// Esnaf kimlikleri hesap numarasından üretilir: meslek + isim. Türkçe hal eki için ünlü uyumu uygulanır.

const JOBS = [
  "Fırıncı",
  "Manav",
  "Kasap",
  "Berber",
  "Terzi",
  "Bakkal",
  "Çiçekçi",
  "Kırtasiyeci",
  "Balıkçı",
  "Simitçi",
  "Tamirci",
  "Eczacı",
];

const NAMES = [
  "Mehmet",
  "Ayşe",
  "Mustafa",
  "Fatma",
  "Ahmet",
  "Zeynep",
  "Ali",
  "Hatice",
  "Hasan",
  "Emine",
  "İbrahim",
  "Elif",
  "Murat",
  "Selin",
  "Hüseyin",
  "Gül",
  "Osman",
  "Deniz",
  "Yusuf",
];

const VOWELS = "aeıioöuü";
const BACK = "aıou";

/** Kimlik: id < 228 için benzersiz (12 ve 19 aralarında asal); sonrası için numara eklenir. */
export function merchantName(id) {
  const base = `${JOBS[id % JOBS.length]} ${NAMES[id % NAMES.length]}`;
  return id < JOBS.length * NAMES.length ? base : `${base} ${Math.floor(id / (JOBS.length * NAMES.length)) + 1}`;
}

function lastVowel(word) {
  for (let i = word.length - 1; i >= 0; i--) if (VOWELS.includes(word[i])) return word[i];
  return "e";
}

function lower(word) {
  return word.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

/** Yönelme hali: "Ayşe'ye", "Mehmet'e", "Fırıncı Mehmet'e", "Ali'ye". Son sözcüğe ek gelir. */
export function toward(name) {
  const w = lower(name.split(" ").filter((p) => !/^\d+$/.test(p)).pop());
  const endsVowel = VOWELS.includes(w[w.length - 1]);
  const a = BACK.includes(lastVowel(w)) ? "a" : "e";
  const suffix = (endsVowel ? "y" : "") + a;
  const shown = name.replace(/\s+\d+$/, "");
  const num = name.match(/\s+(\d+)$/);
  return `${shown}'${suffix}${num ? ` ${num[1]}` : ""}`;
}
