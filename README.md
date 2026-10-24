# TAKAS: İşletmeler arası zincir üstü takas odası

## Neden TAKAS?

Ticarette her şirketin birbirine az çok borcu vardır ve bu borçlar çoğu zaman çekle ödenir. Çek zamanında ödenmezse şirketin itibarı zedelenir; bu yüzden şirket, kasası boş olsa bile çeki ödemek zorunda kalır. Örneğin değeri 10 milyon lira olan arsasını, sırf çeki zamanında ödeyebilmek için 4–5 milyona satar: arsayı alan kazanır, şirket boş yere zarara girer. Türkiye'de 2026'nın ilk dokuz ayında 270 milyar liralık çek karşılıksız kaldı (TBB Risk Merkezi).

Oysa aynı şirketin de alacakları vardır ve borçların çoğu aslında birbirini götürür. TAKAS'ta şirketler borçlarını sisteme ekler; Monad üzerinde tüm borçlar otomatik olarak eşleşir ve ödenebilen her borç tek bir atomik işlemde kapanır. Ağ büyüdükçe daha çok borç birbirini götürür.

**Kazan-kazan:** Şirket hem nakdini hem itibarını korur; TAKAS eşleşen her işlemden küçük bir komisyon alır. Aynı altyapı toplu maaş ödemelerini de tek işlemde yapar.

*Arsa örneği temsilidir.*

**Canlı demo:** https://takas-six.vercel.app · **Tek tıkla dene: [/#/demo](https://takas-six.vercel.app/#/demo)** · **Ağ:** Monad Testnet

## Problem
Türkiye'de 2026'nın ilk 9 ayında 257.985 karşılıksız çek yazıldı, toplam 270 milyar TL (TBB Risk Merkezi; tutar yıllık yaklaşık +%50, adet yaklaşık +%15). Bunun bir kısmı nakit sıkışıklığından geliyor: KOBİ'ler ve tedarik zincirleri birbirine zincirleme borçlu. A, B'ye; B, C'ye; C, A'ya borçlu. Herkes alacaklı, ama herkes nakit arıyor.

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

## Kullanım alanları
- **Tedarik zinciri borç takası (ana kullanım):** Zincirdeki işletmeler birbirine olan borçlarını dönem sonunda tek işlemde netleştirir; yalnızca net fark nakit olarak hareket eder.
- **Toplu maaş ve hakediş ödemeleri:** Şirket çalışanlarına veya taşeronlarına borç yazar, takas anında hepsi tek işlemde ödenir. Alıcı kayıtlı olmalıdır (teminatı 0 olabilir); ödeme alıcının teminat hesabına geçer ve `withdraw()` ile çekilir. Alıcının ağda başka bir borcu varsa o da aynı anda netleşir. Monad'da tek işlemde 20.000 fatura kapandı (ölçüldü), yani on binlerce ödemenin tek işlemde yapılması mümkündür. **Toplu maaş ve hakediş: [#/demo](https://takas-six.vercel.app/#/demo)'da "Maaş günü" senaryosu** (1 şirket, 200 çalışan, 200 maaş tek işlemde). Ödeyen şirketin teminatı net ödemesini ve takas ücretini karşılamalıdır.
- **Ticaret odaları ve toptancı ağları:** Üyeler arasında dönemsel (haftalık, aylık) toplu takas.

## Neden Monad? (ölçüldü)
Takas, tüm defteri tek işlemde okuyup günceller. Bu iş depolama ağırlıklıdır.

| | Monad Testnet | Ethereum kuralları (anvil, EIP-7825) |
|---|---|---|
| Tek işlemde takas | **20.000 fatura / 10.000 işletme**, 26.971.768 gas (ölçüldü) | 2.500 işletmede 16,78M sınırını aşıp **düştü** (ölçüldü) |
| Tek işleme sığan işletme | 10.000 (ölçüldü) | ≈ 2.421 (hesaplandı) |
| İşlem başı sınır | 30M (blok sınırı 150M) | 16.777.216 (EIP-7825) |

10.000 işletmelik takas 26.971.768 gas ile Monad'ın 30M işlem sınırının altında kaldı. Ethereum'da aynı iş 16.777.216 sınırının çok üstünde (≈ 70M) kalır.

Kanıt işlemi: [Monad testnet explorer](https://testnet.monadexplorer.com/tx/0xa7adf24e16719ab9f4a7dd9f05198ab7f03eea0e63dc0a0ca49a476cc9ad5ab3)

Ölçümün yapıldığı `TakasStress`, `Takas`'ı miras alır ve `settle()`'ı değiştirmez. Ölçüm kontratının zincirdeki çalışma kodu, ölçüm anındaki `contracts/src` derlemesiyle bayt bayt aynıydı; sonradan `TakasStress`'e yalnızca demo için `seedPayroll` eklendi, `settle()`'ın bulunduğu `Takas.sol` değişmedi. Canlı `Takas` kontratının zincirdeki çalışma kodu da güncel derlemeyle bayt bayt aynıdır.

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
- Takas: [`0xaff5523654912af1397d546d47b52028cdf8317e`](https://testnet.monadexplorer.com/address/0xaff5523654912af1397d546d47b52028cdf8317e)
- TakasStress (ölçüm, 10.000 işletmelik gerçek takas bu kontratta yapıldı): [`0x4e212ec77ef2d0a2588e0337da72b7cf41434492`](https://testnet.monadexplorer.com/address/0x4e212ec77ef2d0a2588e0337da72b7cf41434492)

- Demo (`/#/demo`; canlı Takas'a dokunmayan, ayrı iki TakasStress örneği):
  - Tedarik zinciri: [`0x04d2877d8b1d29dba5ff2ec3bf553b173a4e506c`](https://testnet.monadexplorer.com/address/0x04d2877d8b1d29dba5ff2ec3bf553b173a4e506c)
  - Maaş günü: [`0xb9e96a3852c16e16c7ae8822a1d8787e52bc4cbb`](https://testnet.monadexplorer.com/address/0xb9e96a3852c16e16c7ae8822a1d8787e52bc4cbb)

Güncel adresler `src/deployment.js` dosyasındadır.

## Sayfalar
| Sayfa | Ne yapar |
|---|---|
| `/#/` | Büyük ekran: QR, canlı borç ağı, "borç → gereken nakit", tasarruf ve TAKAS kazancı |
| `/#/play` | Telefon: şirketini kaydet, borç yaz, net durum, takas sonucu |
| `/#/host` | Takası tetikleme (token korumalı) |
| `/#/olcum` | Monad ve Ethereum ölçüm grafiği |
| `/#/demo` | Herkese açık demo, iki senaryo: "Tedarik zinciri" (10 şirket, 20 borç) ve "Maaş günü" (1 şirket, 200 çalışan). Senaryoyu seç, TAKAS'a bas. Sentetik işletmeler, gerçek Monad testnet işlemleri |

## Mimari
```
src/               Vite + React arayüzü (viem ile okuma/yazma)
api/               Vercel serverless fonksiyonları (ayrı sunucu yok)
  state.js         kontrat durumu, Cache-Control: s-maxage=1
  drip.js          yeni cüzdana 0,2 MON, her adrese bir kez
  settle.js        host anahtarıyla takas
  demo/            herkese açık demo: state, seed (iki senaryo), settle; hız sınırlı
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

## Kaynaklar
- Karşılıksız çek verisi (TBB Risk Merkezi, 2026 ilk 9 ay): https://www.alomaliye.com/2026/10/16/karsiliksiz-cek-tutari-yuzde-50-artti/
- Monad gas sınırları (işlem başı 30M, blok 150M): https://docs.monad.xyz/developer-essentials/gas-pricing
- Monad MIP-8 / opcode fiyatlandırması: https://docs.monad.xyz/developer-essentials/opcode-pricing
- EIP-7825 işlem başı gas sınırı (Fusaka): https://blog.ethereum.org/2025/10/21/fusaka-gascap-update

## Lisans
MIT
