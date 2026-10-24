# TAKAS: İşletmeler arası zincir üstü takas odası

**Canlı demo:** https://takas-six.vercel.app · **Ağ:** Monad Testnet

## Problem
Türkiye'de 2026'nın ilk 9 ayında 257.985 karşılıksız çek yazıldı, toplam 270 milyar TL (TBB Risk Merkezi, yıllık +%50). Bunun bir kısmı nakit sıkışıklığından geliyor: KOBİ'ler ve tedarik zincirleri birbirine zincirleme borçlu. A, B'ye; B, C'ye; C, A'ya borçlu. Herkes alacaklı, ama herkes nakit arıyor.

## Çözüm
TAKAS, işletmelerin birbirine olan borçlarını **tek bir atomik işlemde** çok taraflı olarak netleştirir. Herkes sadece **net** borcunu öder.

- **Kayıt:** İşletme kayıt olur ve MON teminat yatırır.
- **Fatura:** Borçlu kendi borcunu yazar (`owe`). Sahte fatura kesilemez.
- **Takas:** `settle()` tüm açık faturaları tek işlemde netleştirir. Net borçlunun teminatından düşülür, net alacaklıya eklenir.
- **Dışlama:** Teminatı net borcuna yetmeyen işletme o seansta dışlanır. Faturaları bir sonraki takasa kalır, zincir bozulmaz.
- **Sicil:** Zamanında kapanan borçlar zincir üstü sicile işlenir.

Varsayımsal örnek: 230 MON'luk bir borç zinciri yalnızca 40 MON nakit hareketiyle kapanabilir. Gerçek oran faturaların grafiğine bağlıdır; canlı demoda büyük ekran "borç → gereken nakit" sayacını gerçek verilerle gösterir.

## İş modeli (kazan-kazan)
- **İşletme kazanır:** Nakit ihtiyacı büyük ölçüde azalır, karşılıksız çek riski düşer.
- **TAKAS kazanır:** Takasta kapanan her fatura için küçük sabit bir ücret (0,0005 MON), borçlunun teminatından kesilip kasada birikir. Yani yalnızca işletmeye kazandırdığımızdan pay alırız. Kurucu `setFee()` ile ücreti ayarlar, `withdrawFees()` ile kasayı çeker.
- **Yol haritası:** Boştaki teminatın getirisi (Monad üzerindeki borç verme protokolleri), alacağını erken nakde çevirme (faktoring), ticaret odaları ve tedarik ağları için kurumsal lisans.

## Neden Monad? (ölçüldü)
Takas, tüm defteri tek işlemde okuyup günceller. Bu iş depolama ağırlıklıdır.

| | Monad Testnet | Ethereum kuralları (anvil, EIP-7825) |
|---|---|---|
| Tek işlemde takas | **20.000 fatura / 10.000 işletme**, 26.971.768 gas (ölçüldü) | 2.500 işletmede 16,78M sınırını aşıp **düştü** (ölçüldü) |
| Tek işleme sığan işletme | 10.000+ (ölçüldü) | ≈ 2.421 (hesaplandı) |
| İşlem başı gas sınırı | blok gas limiti 150M; 28,6M'lik işlem geçti (ölçüldü) | 16.777.216 (EIP-7825) |

Kanıt işlemi: [Monad testnet explorer](https://testnet.monadexplorer.com/tx/0xa7adf24e16719ab9f4a7dd9f05198ab7f03eea0e63dc0a0ca49a476cc9ad5ab3)

Ham veri: [`public/bench.json`](public/bench.json). Her rakam kaynağıyla etiketlidir: **ölçülen** (gerçek işlem makbuzu ve `Settled` olayı), **tahmin** (`eth_estimateGas`, işlem gönderilmedi), **hesaplanan** (ölçülen değerlerden türetildi). Grafik: `/#/olcum`.

| İşletme | Monad (tahmin) | Ethereum kuralları (tahmin) |
|---:|---:|---:|
| 500 | 1.466.068 | 3.587.735 |
| 1.000 | – | 7.054.663 |
| 2.000 | 5.570.695 | 14.044.362 |
| 2.500 | – | 17.322.976 (sınırı aşıyor; gerçek işlem düştü) |
| 5.000 | 13.727.411 | 34.810.234 |
| 10.000 | 27.212.368 (gerçek işlem: 26.971.768) | 70.004.263 |

**Tasarım: "Sayfa Defteri".** Hesaplar ve faturalar `mapping` yerine sıralı numaralarla, slot başına iki kayıt olacak şekilde yan yana tutulur. Monad'ın MIP-8 sayfa bazlı depolama fiyatlandırmasında aynı 128 slotluk sayfadaki erişimler çok ucuzdur. Monad'da darboğaz depolamadan hesaplamaya kaydığı için `settle()` bellekte işletme başına tek kelimelik paketli durumla, az döngüyle çalışır.

## Kontratlar (Monad Testnet, chainId 10143)
- Takas: [`0x670f4f68c7993d13361a1ef6987f03f3c049930d`](https://testnet.monadexplorer.com/address/0x670f4f68c7993d13361a1ef6987f03f3c049930d)
- TakasStress (ölçüm, 10.000 işletmelik gerçek takas bu kontratta yapıldı): [`0x4e212ec77ef2d0a2588e0337da72b7cf41434492`](https://testnet.monadexplorer.com/address/0x4e212ec77ef2d0a2588e0337da72b7cf41434492)

Güncel adresler `src/deployment.js` dosyasındadır.

## Sayfalar
| Sayfa | Ne yapar |
|---|---|
| `/#/` | Büyük ekran: QR, canlı borç ağı, "borç → gereken nakit", tasarruf ve TAKAS kazancı |
| `/#/play` | Telefon: şirketini kaydet, borç yaz, net durum, takas sonucu |
| `/#/host` | Takası tetikleme (token korumalı) |
| `/#/olcum` | Monad ve Ethereum ölçüm grafiği |

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

Telefonlar RPC anahtarını görmez; bütün istekler `/api/rpc` üzerinden geçer. Telefon cüzdanı tarayıcıda üretilir ve `localStorage`'da durur; yalnızca testnet içindir. Şirket adları kurgusaldır.

## Kurulum
Gereksinimler: Node 22+, [Foundry](https://getfoundry.sh).

    npm install
    cd contracts && forge build && forge test
    cd .. && npm run dev

Testler: birim testleri, algoritmanın bağımsız JS referans uygulamasıyla (`contracts/test/js/takas-ref.cjs`) rastgele senaryolarda birebir karşılaştırma, "teminat toplamı + kasa = kontrat bakiyesi" invariant'ı ve gas ölçekleme.

Ortam değişkenleri (`contracts/.env` yerelde, Vercel'de proje ayarları; repoya girmez): `HOST_PRIVATE_KEY`, `MONAD_RPC_URL`, `HOST_TOKEN`.
Yayın: Vercel (Vite arayüzü + `/api` serverless fonksiyonları).

Betikler:

    node scripts/deploy.mjs         # Takas + TakasStress'i yayınlar
    node scripts/bench-eth.mjs      # anvil (prague) ölçümü
    node scripts/bench-monad.mjs    # Monad testnet ölçümü
    node scripts/sim.mjs 8 16       # demo için geçici işletme ve borç üretir

## Monad testnet'te karşılaştığımız davranışlar ve önlemler
- **Gas limiti:** Monad gas limitinin tamamını ücretlendirir; makbuzdaki `gasUsed` limiti gösterir. Limitler tahmin + küçük pay olarak verilir, gerçek tüketim `Settled` olayından okunur.
- **Kayıt ve fatura maliyeti:** Çift ve tek numaralı kayıtlar farklı maliyetlidir. Eşzamanlı işlemler için `register` ve `owe` tahminine +30.000 gas pay eklenir.
- **Yeni gelen bakiye:** Yeni fonlanan cüzdan hemen işlem gönderirse "insufficient balance" dönebilir. Aynı imzalı işlem 1-2-3 sn aralıklarla yeniden yayınlanır.
- **RPC yedeği:** Sağlayıcı geçerli işlemi reddederse veya 429/5xx dönerse yedek RPC'ye (`https://testnet-rpc.monad.xyz`) geçilir. Revert eden işlem yeniden gönderilmez.
- **Log sorguları:** Alchemy `eth_getLogs` 10 blokla sınırlı. Kontrat son takasın blok numarasını saklar; olay tek blokluk aralıkla okunur.
- **Onay:** İşlem makbuzu 500 ms aralıkla sorulur.

## Bilinen eksikler
- Faturalar borçlunun kendi beyanıdır. Gerçek kullanımda e-fatura (GİB) entegrasyonu gerekir.
- Teminat MON'dur. Gerçek kullanımda stablecoin (USDC) olmalıdır.
- Tutarlar zincir üstünde herkese açıktır. Gizlilik ileride ele alınacaktır.
- Ölçek testinde sentetik işletmeler kullanılmıştır. Canlı demo gerçek cüzdanlarla çalışır.

## Lisans
MIT
