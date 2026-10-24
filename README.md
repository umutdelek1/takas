# TAKAS

**Esnaf için zincir üstü çok taraflı borç netleştirme.** Monad Blitz projesi.

Esnaf birbirine sürekli borçlanır: manav toptancıya, toptancı nakliyeciye, nakliyeci manava. Her fatura ayrı ayrı nakitle kapanınca gereksiz para dolaşır. TAKAS bütün açık faturaları **tek atomik işlemde** netleştirir: herkes yalnızca **net** borcunu öder, döngüler nakitsiz kapanır.

> Canlı uygulama: **https://takas-six.vercel.app**
> Telefon: https://takas-six.vercel.app/#/play · Büyük ekran: https://takas-six.vercel.app/#/ · Ölçüm: https://takas-six.vercel.app/#/olcum
> Ağ: Monad testnet (chainId 10143)

## Nasıl çalışır

1. `register()` (payable): esnaf kayıt olur, MON teminat yatırır. `deposit()` / `withdraw()` ile teminat ekler veya çeker.
2. `owe(alacakli, tutar)`: **borçlu** kendi borcunu yazar. Kimse başkası adına fatura kesemez.
3. `settle()` (herkese açık): tüm açık faturalar tek işlemde netleşir.
   - Her esnaf net borcunu teminatından öder, net alacaklıların teminatı artar.
   - Teminatı `net borç + kapanacak fatura × ücret` tutarını karşılamayan esnaf, faturalarıyla birlikte o seanstan dışlanır. Dışlama, durum sabitlenene kadar tekrar hesaplanır. Dışlanan faturalar sonraki seansa kalır.
   - Her esnafın **sicil**i (kapanan borç faturası sayısı) artar.
4. `previewSettle()` (view): sonucu önceden gösterir.

**Gelir modeli:** Takasta kapanan her fatura için sabit takas ücreti (0,0005 MON) borçlunun teminatından kesilir ve kontrattaki kasada birikir. Kurucu `setFee()` ile ücreti ayarlar, `withdrawFees()` ile kasayı çeker.

`Settled` olayı ve `previewSettle()` şunları döndürür: kapanan fatura, katılımcı, dışlanan, brüt borç, el değiştiren nakit, esnafın nakit tasarrufu (brüt − nakit), toplam ücret, kullanılan gas.

## Sayfalar

| Adres | Ne işe yarar |
|---|---|
| `#/` | Büyük ekran: QR, borç ağı grafiği, "borç → gereken nakit" ve "esnaf tasarrufu / TAKAS kasası" sayaçları, son takas, Monad/Ethereum karşılaştırması |
| `#/play` | Telefon: geçici cüzdan, otomatik MON, dükkân aç, esnaf seç + borç yaz, net durum, takas sonrası sonuç kartı |
| `#/host` | Önizleme ve TAKAS butonu (host anahtarı gerekir) |
| `#/olcum` | `settle()` gas ölçümü grafiği ve gerçek işlemler |

## Mimari

```
src/               Vite + React arayüzü (viem ile okuma/yazma)
api/               Vercel serverless fonksiyonları (ayrı sunucu yok)
  state.js         kontrat durumu, Cache-Control: s-maxage=1
  drip.js          yeni cüzdana 0,2 MON, her adrese bir kez
  settle.js        host anahtarıyla takas
  rpc.js           telefonlar için RPC vekili (yeniden dene, yedek RPC, anahtar gizli)
contracts/         Foundry: Takas.sol, TakasStress.sol, testler
scripts/           deploy, ölçüm ve yardımcı betikler (Node)
public/bench.json  ölçüm sonuçları
```

- Telefonlar RPC anahtarını görmez; bütün istekler `/api/rpc` üzerinden geçer. Okuma yöntemleri ve işlem yayını dışındaki her şey kapalıdır.
- `/api/state` yanıtı 1 sn önbelleğe alınır; 40 telefon aynı anda yoklasa bile RPC'ye saniyede tek istek gider.
- `/api/drip` her adrese bir kez gönderir: alıcının bakiyesi 0 ve işlem sayısı 0 olmalıdır, kalıcı veritabanı gerekmez.
- Telefon cüzdanı tarayıcıda üretilir ve `localStorage`'da durur. Yalnızca testnet için tasarlanmıştır.

## Kontrat tasarımı (Monad için)

- **Sayfa bazlı depolama (MIP-8):** Hesaplar ve faturalar mapping'de değil, sıralı numaralarla dinamik dizilerde durur; slot başına 2 kayıt paketlidir. `settle()` bitişik slotları sırayla okur. Tutarlar 1e12 wei birimiyle tutulur. Mapping yalnızca adres → numara için kullanılır.
- **Darboğaz hesaplamadır, depolama değil:** `settle()` bellekte esnaf başına **tek kelime** kullanır (alacak, borç, fatura sayısı, teminat, dışlama bayrakları). Faturalar tek geçişte toplanır. Dışlama turlarında her şey baştan hesaplanmaz; yalnızca yeni pasifleşen faturaların katkısı geri alınır. Sıcak döngüler inline assembly ile yazıldı.
- **TakasStress:** Ölçüm için sentetik esnaf ve fatura üretir, para giriş-çıkışı kapalıdır. Sentetik esnafın adres kaydı yazılmaz; `settle()` zaten yalnızca dizi uzunluğunu ve hesap kelimelerini okur.

## Monad testnet'te bilinen davranışlar ve önlemler

| Davranış | Önlem |
|---|---|
| Monad işlemde **gas limitinin tamamını** ücretlendirir; makbuzdaki `gasUsed` limiti gösterir. | Her işlemde limit = `eth_estimateGas` + küçük pay. Sabit büyük limit hiçbir yerde kullanılmaz. Gerçek tüketim `Settled` olayındaki `gasUsed` alanından okunur. |
| `register` ve `owe` maliyeti hesabın çift ya da tek numaralı olmasına göre değişir (slot başına 2 hesap paketli). Aynı anda gönderilen işlemlerde tahmin yetmeyebilir. | Telefon ve betikler bu iki çağrıda tahmine **+30.000 gas** ekler. |
| Yeni gelen MON ile hemen işlem gönderilirse RPC bazen "insufficient balance" der. | `/api/rpc`, aynı imzalı işlemi 1-2-3 sn arayla yeniden yayınlar. Tahmin aşamasında da kısa bekleme ve yeniden deneme vardır. |
| Alchemy bazen geçerli bir işlemi reddedebilir. | Yedek RPC `https://testnet-rpc.monad.xyz` otomatik denenir. 429/5xx yanıtlarında yeniden denenir; zincirde revert olan işlem tekrar gönderilmez. |
| Alchemy `eth_getLogs` en fazla 10 blok aralığı kabul eder. | Kontrat son takasın blok numarasını saklar (`lastSettleBlock`); `Settled` olayı tek blokluk aralıkla okunur. |
| Onay bekleme. | İşlem makbuzu 500 ms aralıkla sorulur. |
| Aynı host cüzdanından eşzamanlı işlemler (bağış + takas) nonce çakıştırabilir. | `sendWithRetry`, nonce çakışmasında kısa rastgele beklemeyle yeniden dener. |

Telefonda teminat 0,1 MON, borç seçenekleri 0,01 / 0,02 / 0,05 MON'dur. Hata mesajları Türkçe ve anlaşılırdır.

## settle() gas ölçümü

Aynı kontrat (TakasStress), esnaf başına 2 fatura, iki ortamda büyütüldü. Ham veri: [`public/bench.json`](public/bench.json), grafik: `#/olcum`.

| Esnaf | Monad testnet (gas) | Ethereum kuralları (gas) |
|---:|---:|---:|
| 500 | 1.466.068 | 3.587.735 |
| 1.000 | – | 7.054.663 |
| 2.000 | 5.570.695 | 14.044.362 |
| 2.500 | – | 17.322.976 (sınırı aşıyor) |
| 5.000 | 13.727.411 | 34.810.234 |
| 10.000 | 27.212.368 | 70.004.263 |

- **Ethereum kuralları:** `anvil --hardfork prague`; işlem başı sınır 16.777.216 (EIP-7825). 2.500 esnaflık durumda `settle()` bu limitle gönderildi ve gas yetmeyip **düştü**. Sınır içinde tek işlemde yaklaşık 2.400 esnaf takas edilebilir.
- **Monad testnet:** 10.000 esnaf ve 20.000 fatura **tek gerçek `settle()` işleminde** kapandı. Olaydaki `gasUsed` 26.971.768, verilen limit 28.592.986 (tahmin + pay). İşlem: [explorer'da gör](https://testnet.monadexplorer.com/tx/0xa7adf24e16719ab9f4a7dd9f05198ab7f03eea0e63dc0a0ca49a476cc9ad5ab3).
- Ölçüm için toplam 34,3 MON harcandı (bütçe 150 MON).

Tablodaki değerler, her ağın kendi gas kurallarıyla alınmış `eth_estimateGas` sonuçlarıdır; Monad'da en büyük boyut ayrıca gerçek işlemle doğrulanmıştır.

## Kontratlar (Monad testnet)

Adresler `src/deployment.js` dosyasındadır.

## Kurulum

Gerekenler: Node.js 22+, [Foundry](https://getfoundry.sh).

```bash
npm install
cd contracts && forge test
```

Testler: birim testleri, algoritmanın bağımsız JS referans uygulamasıyla (`contracts/test/js/takas-ref.cjs`) rastgele senaryolarda birebir karşılaştırma, "teminat toplamı + kasa = kontrat bakiyesi" invariant'ı ve gas ölçekleme.

Yerel geliştirme (`/api` işleyicileri Vite içinde çalışır):

```bash
npm run dev
```

Ortam değişkenleri (`contracts/.env` yerelde, Vercel'de proje ayarları):

| Ad | Açıklama |
|---|---|
| `HOST_PRIVATE_KEY` | Bağış ve takas işlemlerini imzalayan cüzdan (Monad testnet MON'u olmalı) |
| `MONAD_RPC_URL` | Birincil RPC (yedek: `https://testnet-rpc.monad.xyz`) |
| `HOST_TOKEN` | `#/host` sayfasının takas tetiklemek için kullandığı rastgele anahtar |

`.env` dosyaları git'e girmez.

Dağıtım ve ölçüm betikleri:

```bash
node scripts/deploy.mjs            # Takas + TakasStress'i yayınlar, src/deployment.js'i yazar
node scripts/bench-eth.mjs         # anvil (prague) ölçümü
node scripts/bench-monad.mjs       # Monad testnet ölçümü
node scripts/sim.mjs 8 16          # demo için geçici esnaf ve borç üretir
```

## Lisans

MIT
