# TAKAS

**Esnaf için zincir üstü çok taraflı borç netleştirme.** Monad Blitz projesi, yapım aşamasında.

Esnaf birbirine sürekli borçlanır: manav toptancıya, toptancı nakliyeciye, nakliyeci manava. Her fatura ayrı ayrı nakitle kapanınca gereksiz para dolaşır. TAKAS bütün açık faturaları tek atomik işlemde netleştirir: herkes yalnızca **net** borcunu öder, döngüler nakitsiz kapanır.

## Nasıl çalışır

1. `register()` (payable): esnaf kayıt olur, MON teminat yatırır. `deposit()` / `withdraw()` ile teminat ekler veya çeker.
2. `owe(alacakli, tutar)`: **borçlu** kendi borcunu yazar. Kimse başkasına sahte fatura kesemez.
3. `settle()` (herkese açık): tüm açık faturalar tek işlemde netleşir.
   - Her esnaf net borcunu teminatından öder, net alacaklıların teminatı artar.
   - Teminatı `net borç + kapanacak fatura × ücret` tutarını karşılamayan esnaf, faturalarıyla birlikte o seanstan dışlanır. Hesap sabitlenene kadar tekrarlanır. Dışlanan faturalar sonraki seansa kalır.
   - Her esnafın **sicil**i (kapanan borç faturası sayısı) artar.
4. `previewSettle()` (view): sonucu önceden gösterir.

**Gelir modeli:** Kapanan her fatura için sabit takas ücreti (örn. 0,0005 MON) borçlunun teminatından kesilir ve kontrattaki kasada birikir. Kurucu `setFee()` ile ücreti ayarlar, `withdrawFees()` ile kasayı çeker.

`Settled` olayı ve `previewSettle()` şunları döndürür: kapanan fatura, katılımcı, dışlanan, brüt borç, el değiştiren nakit, esnafın nakit tasarrufu (brüt − nakit), toplam ücret, kullanılan gas.

## Monad için tasarım

- **Sayfa bazlı depolama (MIP-8):** hesaplar ve faturalar mapping yerine sıralı numaralı dinamik dizilerde durur, slot başına 2 kayıt paketlidir. Böylece settle() bitişik slotları okur. Tutarlar 1e12 wei birimiyle tutulur. Yalnızca adres → numara için mapping kullanılır.
- **Hesaplama darboğazı:** settle() bellekte esnaf başına **tek kelime** kullanır (alacak | borç | fatura sayısı | teminat | dışlama bayrakları). Faturalar tek geçişte toplanır. Dışlama turlarında her şey baştan hesaplanmaz, yalnızca yeni pasifleşen faturaların katkısı geri alınır. Sıcak döngüler inline assembly ile yazıldı.
- **TakasStress:** ölçüm için sentetik esnaf ve fatura üreten sürüm. Para yatırma ve çekme kapalıdır.

## Gas (anvil, gerçek işlem makbuzu)

Rastgele fatura grafı, esnaf başına 3 fatura, soğuk depolama:

| Esnaf | Fatura | settle() gas | Esnaf başına | Fatura başına |
|------:|-------:|-------------:|-------------:|--------------:|
|   100 |    300 |      869.570 |        8.696 |         2.899 |
|   500 |  1.500 |    4.200.125 |        8.400 |         2.800 |
| 1.000 |  3.000 |    8.359.316 |        8.359 |         2.786 |

Maliyet doğrusal ölçeklenir. Aynı işlem içinde sıcak depolamayla (forge test) esnaf başına yaklaşık 2.900 gas.

## Proje yapısı

```
contracts/
  src/Takas.sol          ana kontrat
  src/TakasStress.sol    ölçüm sürümü
  test/Takas.t.sol       birim testleri
  test/TakasDiff.t.sol   JS referansıyla rastgele karşılaştırma (FFI)
  test/TakasInvariant.t.sol  teminat + kasa = bakiye invariant'ı
  test/TakasStress.t.sol stres ve gas ölçeklemesi
  test/js/takas-ref.js   algoritmanın bağımsız JS referans uygulaması
  script/StressGas.s.sol anvil gas ölçüm betiği
```

## Çalıştırma

Gerekenler: [Foundry](https://getfoundry.sh) ve Node.js (farklılık testi için).

```bash
cd contracts
forge test
```

Anvil'de gas ölçümü (özel anahtar gerekmez, anvil'in kilitsiz hesabı kullanılır):

```bash
anvil --gas-limit 1000000000
```

```bash
forge script script/StressGas.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --slow
```

## Lisans

MIT
