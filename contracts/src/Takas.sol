// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title TAKAS — esnaf için zincir üstü çok taraflı borç netleştirme
/// @notice Esnaf MON teminat yatırır, borçlu kendi borcunu yazar, settle() tüm açık
///         faturaları tek atomik işlemde netleştirir. Herkes yalnızca net borcunu öder.
/// @dev Depolama Monad MIP-8 (sayfa bazlı depolama) düşünülerek düzenlendi: hesaplar ve
///      faturalar sıralı numaralarla dinamik dizilerde, slot başına 2 kayıt paketli durur.
///      Tutarlar 1e12 wei'lik birimlerle (UNIT) tutulur.
contract Takas {
    // ───────────────────────────── sabitler ─────────────────────────────

    /// @notice Tutar birimi: 1e12 wei (0,000001 MON).
    uint256 public constant UNIT = 1e12;
    /// @notice Tek faturanın üst sınırı (birim): 2^48-1 ≈ 281 milyon MON.
    uint256 public constant MAX_INVOICE_UNITS = type(uint48).max;
    /// @notice Takas ücretinin üst sınırı (birim): 1 MON.
    uint256 public constant MAX_FEE_UNITS = 1e18 / UNIT;
    /// @notice Aynı anda açık olabilecek fatura sayısı; bellek kelimesindeki 72 bitlik
    ///         toplamların taşmamasını garanti eder.
    uint256 public constant MAX_OPEN_INVOICES = 1 << 24;

    uint256 internal constant M32 = 0xffffffff;
    uint256 internal constant M64 = 0xffffffffffffffff;
    uint256 internal constant M128 = type(uint128).max;

    // settle() bellek kelimesi (esnaf başına tek uint256):
    //   [0..71]    alacak   (birim)
    //   [72..143]  borç     (birim)
    //   [144..175] kapanacak borç faturası sayısı (= ücret adedi = sicil artışı)
    //   [176..239] teminat  (birim)
    //   [240]      dışlandı
    //   [241]      bu turda dışlandı
    uint256 internal constant M72 = 0xffffffffffffffffff;
    uint256 internal constant DEBIT_SHIFT = 72;
    uint256 internal constant COUNT_SHIFT = 144;
    uint256 internal constant COLL_SHIFT = 176;
    uint256 internal constant EX = 0x1000000000000000000000000000000000000000000000000000000000000; // 1 << 240
    uint256 internal constant NEW_EX = 0x2000000000000000000000000000000000000000000000000000000000000; // 1 << 241

    // ───────────────────────────── depolama ─────────────────────────────

    address public owner;
    uint64 internal _feeUnits;

    uint64 internal _feeBalanceUnits;
    uint32 public session;
    uint32 internal _openInvoices;

    /// @dev Esnaf adresleri, numara sırasıyla.
    address[] internal _members;
    /// @dev Slot başına 2 hesap; her 128 bit: [0..63] teminat (birim) | [64..95] sicil.
    uint256[] internal _accounts;
    /// @dev Slot başına 2 açık fatura; her 128 bit: [0..31] borçlu | [32..63] alacaklı | [64..127] tutar (birim).
    ///      Dizi hiç küçülmez; geçerli kayıt sayısı _openInvoices'tır, eski slotlar yeniden kullanılır.
    uint256[] internal _invoices;
    /// @dev Adres → numara + 1 (0 = kayıtsız).
    mapping(address => uint256) internal _idPlusOne;

    // ───────────────────────────── tipler ─────────────────────────────

    /// @notice Bir takas seansının özeti. Tutarlar wei cinsinden.
    struct SettleStats {
        uint256 invoices; // kapanan fatura sayısı
        uint256 participants; // en az bir faturası kapanan esnaf
        uint256 excluded; // dışlanan esnaf
        uint256 grossWei; // kapanan faturaların toplamı (brüt borç)
        uint256 cashWei; // el değiştiren nakit (net borçlar toplamı)
        uint256 savedWei; // esnafın nakit tasarrufu = brüt - nakit
        uint256 feesWei; // toplam takas ücreti
        uint256 gasUsed; // hesaplama + yazma için harcanan gas
    }

    // ───────────────────────────── olaylar / hatalar ─────────────────────────────

    event Registered(address indexed merchant, uint256 indexed id, uint256 collateralWei);
    event Deposited(address indexed merchant, uint256 amountWei);
    event Withdrawn(address indexed merchant, uint256 amountWei);
    event Owed(address indexed debtor, address indexed creditor, uint256 amountWei);
    event Settled(uint256 indexed session, SettleStats stats);
    event FeeChanged(uint256 feeWei);
    event FeesWithdrawn(address indexed to, uint256 amountWei);

    error NotOwner();
    error NotRegistered();
    error AlreadyRegistered();
    error ZeroAmount();
    error NotUnitMultiple();
    error SelfInvoice();
    error AmountTooLarge();
    error InsufficientCollateral();
    error TooManyInvoices();
    error TooManyMembers();
    error NoOpenInvoices();
    error FeeTooHigh();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(uint256 feeWei) {
        owner = msg.sender;
        _setFee(feeWei);
    }

    // ───────────────────────────── esnaf işlemleri ─────────────────────────────

    /// @notice Kayıt ol; gönderilen MON teminat olur (0 olabilir).
    function register() external payable virtual {
        if (_idPlusOne[msg.sender] != 0) revert AlreadyRegistered();
        uint256 units = _units(msg.value);
        uint256 id = _addMember(msg.sender, units);
        emit Registered(msg.sender, id, msg.value);
    }

    /// @notice Teminat ekle.
    function deposit() external payable virtual {
        uint256 id = _idOf(msg.sender);
        uint256 units = _units(msg.value);
        if (units == 0) revert ZeroAmount();
        (uint256 coll, uint256 sicil) = _account(id);
        coll += units;
        if (coll > M64) revert AmountTooLarge();
        _setAccount(id, coll, sicil);
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Teminat çek. Açık faturalar takasa kadar teminata dokunmaz; yetersiz teminat dışlanmaya yol açar.
    function withdraw(uint256 amountWei) external virtual {
        uint256 id = _idOf(msg.sender);
        uint256 units = _units(amountWei);
        if (units == 0) revert ZeroAmount();
        (uint256 coll, uint256 sicil) = _account(id);
        if (units > coll) revert InsufficientCollateral();
        _setAccount(id, coll - units, sicil);
        emit Withdrawn(msg.sender, amountWei);
        _send(msg.sender, amountWei);
    }

    /// @notice Borçlu kendi borcunu yazar (sahte fatura yazılamaz).
    function owe(address creditor, uint256 amountWei) external {
        uint256 d = _idOf(msg.sender);
        uint256 c = _idPlusOne[creditor];
        if (c == 0) revert NotRegistered();
        unchecked {
            c -= 1;
        }
        if (c == d) revert SelfInvoice();
        uint256 units = _units(amountWei);
        if (units == 0) revert ZeroAmount();
        if (units > MAX_INVOICE_UNITS) revert AmountTooLarge();
        _addInvoice(d, c, units);
        emit Owed(msg.sender, creditor, amountWei);
    }

    // ───────────────────────────── takas ─────────────────────────────

    /// @notice Tüm açık faturaları tek atomik işlemde netleştirir. Herkes çağırabilir.
    function settle() external returns (SettleStats memory s) {
        uint256 g0 = gasleft();
        uint256 m = _openInvoices;
        if (m == 0) revert NoOpenInvoices();

        uint256[] memory st = _compute(m);
        uint256 feeUnits;
        (s, feeUnits) = _apply(st);

        if (s.excluded == 0) {
            _openInvoices = 0;
        } else {
            _compact(st, m);
        }
        uint256 bal = _feeBalanceUnits + feeUnits;
        if (bal > M64) revert AmountTooLarge();
        // forge-lint: disable-next-line(unsafe-typecast)
        _feeBalanceUnits = uint64(bal);
        uint256 id = session + 1;
        // forge-lint: disable-next-line(unsafe-typecast)
        session = uint32(id);

        s.gasUsed = g0 - gasleft();
        emit Settled(id, s);
    }

    /// @notice settle()'ın şu an çağrılsa üreteceği özet (hiçbir şey yazmaz).
    function previewSettle() external view returns (SettleStats memory s) {
        uint256 g0 = gasleft();
        uint256 m = _openInvoices;
        if (m != 0) s = _summarize(_compute(m));
        s.gasUsed = g0 - gasleft();
    }

    /// @dev Esnaf kelimelerini kurar ve dışlamaları sabitlenene kadar artımlı uygular.
    ///      Her turda teminatı (net borç + fatura × ücret)'i karşılamayan herkes aynı anda
    ///      dışlanır; sonra yalnızca yeni pasifleşen faturaların katkısı geri alınır.
    function _compute(uint256 m) internal view returns (uint256[] memory st) {
        uint256 n = _members.length;
        uint256 feeU = _feeUnits;
        st = new uint256[](n);
        uint256 accSlot;
        uint256 invSlot;
        assembly ("memory-safe") {
            mstore(0, _accounts.slot)
            accSlot := keccak256(0, 0x20)
            mstore(0, _invoices.slot)
            invSlot := keccak256(0, 0x20)
        }
        assembly ("memory-safe") {
            let base := add(st, 0x20)
            let cntOne := shl(COUNT_SHIFT, 1)

            // 1) teminatlar: slot başına 2 hesap
            for { let i := 0 } lt(i, n) { i := add(i, 2) } {
                let w := sload(add(accSlot, shr(1, i)))
                mstore(add(base, shl(5, i)), shl(COLL_SHIFT, and(w, M64)))
                if lt(add(i, 1), n) { mstore(add(base, shl(5, add(i, 1))), shl(COLL_SHIFT, and(shr(128, w), M64))) }
            }

            // 2) tüm faturaları topla: borçluya borç + sayaç, alacaklıya alacak
            for { let j := 0 } lt(j, m) { j := add(j, 2) } {
                let w := sload(add(invSlot, shr(1, j)))
                {
                    let a := and(shr(64, w), M64)
                    let pd := add(base, shl(5, and(w, M32)))
                    mstore(pd, add(mload(pd), add(shl(DEBIT_SHIFT, a), cntOne)))
                    let pcr := add(base, shl(5, and(shr(32, w), M32)))
                    mstore(pcr, add(mload(pcr), a))
                }
                if lt(add(j, 1), m) {
                    w := shr(128, w)
                    let a := and(shr(64, w), M64)
                    let pd := add(base, shl(5, and(w, M32)))
                    mstore(pd, add(mload(pd), add(shl(DEBIT_SHIFT, a), cntOne)))
                    let pcr := add(base, shl(5, and(shr(32, w), M32)))
                    mstore(pcr, add(mload(pcr), a))
                }
            }

            // 3) dışlama turları
            let exNew := or(EX, NEW_EX)
            for {} 1 {} {
                let changed := 0
                for { let i := 0 } lt(i, n) { i := add(i, 1) } {
                    let p := add(base, shl(5, i))
                    let w := mload(p)
                    switch and(w, EX)
                    case 0 {
                        let cnt := and(shr(COUNT_SHIFT, w), M32)
                        // borç faturası yoksa net borç ve ücret 0'dır
                        if cnt {
                            let credit := and(w, M72)
                            let debit := and(shr(DEBIT_SHIFT, w), M72)
                            let need := mul(cnt, feeU)
                            if gt(debit, credit) { need := add(need, sub(debit, credit)) }
                            if gt(need, and(shr(COLL_SHIFT, w), M64)) {
                                mstore(p, or(w, exNew))
                                changed := 1
                            }
                        }
                    }
                    default {
                        if and(w, NEW_EX) { mstore(p, xor(w, NEW_EX)) }
                    }
                }
                if iszero(changed) { break }

                // bu turda pasifleşen faturaların katkısını geri al
                for { let j := 0 } lt(j, m) { j := add(j, 1) } {
                    let w := sload(add(invSlot, shr(1, j)))
                    if and(j, 1) { w := shr(128, w) }
                    let pd := add(base, shl(5, and(w, M32)))
                    let pcr := add(base, shl(5, and(shr(32, w), M32)))
                    let wd := mload(pd)
                    let wc := mload(pcr)
                    // şimdi pasif ve daha önce aktifti (iki taraf da eski turlarda dışlanmamış)
                    if and(or(wd, wc), EX) {
                        if iszero(or(eq(and(wd, exNew), EX), eq(and(wc, exNew), EX))) {
                            let a := and(shr(64, w), M64)
                            mstore(pd, sub(wd, add(shl(DEBIT_SHIFT, a), cntOne)))
                            mstore(pcr, sub(wc, a))
                        }
                    }
                }
            }
        }
    }

    /// @dev Sonuçları hesaplara yazar (slot başına 2 hesap, tek SSTORE) ve özeti çıkarır.
    function _apply(uint256[] memory st) internal returns (SettleStats memory s, uint256 feeUnits) {
        uint256 n = st.length;
        uint256 feeU = _feeUnits;
        // döngü boyunca grossWei/cashWei birim tutar, sonda wei'ye çevrilir
        for (uint256 i; i < n; i += 2) {
            uint256 word;
            bool dirty;
            for (uint256 h; h < 2; ++h) {
                if (i + h >= n) break;
                uint256 x = st[i + h];
                if (x & EX != 0) {
                    ++s.excluded;
                    continue;
                }
                if (x & ((M32 << COUNT_SHIFT) | M72) == 0) continue;
                if (!dirty) {
                    word = _accounts[i >> 1];
                    dirty = true;
                }
                uint256 sh = h << 7;
                word = (word & ~(M128 << sh)) | (_settleOne(x, word >> sh, feeU, s) << sh);
            }
            if (dirty) _accounts[i >> 1] = word;
        }
        feeUnits = s.invoices * feeU;
        s.savedWei = (s.grossWei - s.cashWei) * UNIT;
        s.grossWei *= UNIT;
        s.cashWei *= UNIT;
        s.feesWei = feeUnits * UNIT;
    }

    /// @dev Tek esnafın hesap yarısını (teminat | sicil) günceller, özete ekler.
    function _settleOne(uint256 x, uint256 half, uint256 feeU, SettleStats memory s) internal pure returns (uint256) {
        uint256 cnt = (x >> COUNT_SHIFT) & M32;
        uint256 credit = x & M72;
        uint256 debit = (x >> DEBIT_SHIFT) & M72;
        ++s.participants;
        s.invoices += cnt;
        s.grossWei += debit;
        if (debit > credit) s.cashWei += debit - credit;
        // _compute garantisi: teminat >= max(0, borç - alacak) + ücret
        uint256 coll = (half & M64) + credit - debit - cnt * feeU;
        if (coll > M64) revert AmountTooLarge();
        uint256 sicil = ((half >> 64) & M32) + cnt;
        if (sicil > M32) sicil = M32;
        return coll | (sicil << 64);
    }

    /// @dev _apply ile aynı özet, yazmadan.
    function _summarize(uint256[] memory st) internal view returns (SettleStats memory s) {
        uint256 n = st.length;
        uint256 feeU = _feeUnits;
        uint256 gross;
        uint256 cash;
        for (uint256 i; i < n; ++i) {
            uint256 x = st[i];
            if (x & EX != 0) {
                ++s.excluded;
                continue;
            }
            uint256 cnt = (x >> COUNT_SHIFT) & M32;
            uint256 credit = x & M72;
            if (cnt | credit == 0) continue;
            uint256 debit = (x >> DEBIT_SHIFT) & M72;
            ++s.participants;
            s.invoices += cnt;
            gross += debit;
            if (debit > credit) cash += debit - credit;
        }
        s.grossWei = gross * UNIT;
        s.cashWei = cash * UNIT;
        s.savedWei = (gross - cash) * UNIT;
        s.feesWei = s.invoices * feeU * UNIT;
    }

    /// @dev Dışlanan esnafa dokunan faturaları sırasını koruyarak başa toplar.
    function _compact(uint256[] memory st, uint256 m) internal {
        uint256 out;
        uint256 pending;
        for (uint256 j; j < m; j += 2) {
            uint256 w = _invoices[j >> 1];
            for (uint256 h; h < 2; ++h) {
                if (j + h >= m) break;
                uint256 inv = (h == 0 ? w : w >> 128) & M128;
                if ((st[inv & M32] | st[(inv >> 32) & M32]) & EX == 0) continue;
                if (out & 1 == 0) {
                    pending = inv;
                } else {
                    _invoices[out >> 1] = pending | (inv << 128);
                }
                ++out;
            }
        }
        if (out & 1 == 1) _invoices[out >> 1] = pending;
        // forge-lint: disable-next-line(unsafe-typecast)
        _openInvoices = uint32(out); // out <= m < MAX_OPEN_INVOICES
    }

    // ───────────────────────────── kurucu ─────────────────────────────

    /// @notice Kapanan fatura başına takas ücretini ayarla (wei, UNIT katı, en çok 1 MON).
    function setFee(uint256 feeWei) external onlyOwner {
        _setFee(feeWei);
    }

    /// @notice Kasada biriken ücretleri kurucuya gönder.
    function withdrawFees() external virtual onlyOwner {
        uint256 amount = uint256(_feeBalanceUnits) * UNIT;
        if (amount == 0) revert ZeroAmount();
        _feeBalanceUnits = 0;
        emit FeesWithdrawn(msg.sender, amount);
        _send(msg.sender, amount);
    }

    // ───────────────────────────── okuma ─────────────────────────────

    function fee() external view returns (uint256) {
        return uint256(_feeUnits) * UNIT;
    }

    function feeBalance() external view returns (uint256) {
        return uint256(_feeBalanceUnits) * UNIT;
    }

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function openInvoiceCount() external view returns (uint256) {
        return _openInvoices;
    }

    /// @notice Toplam teminat (wei); invariant: totalCollateral + feeBalance == bakiye.
    function totalCollateral() external view returns (uint256 total) {
        uint256 n = _members.length;
        for (uint256 i; i < n; ++i) {
            (uint256 coll,) = _account(i);
            total += coll;
        }
        total *= UNIT;
    }

    function member(uint256 id) public view returns (address addr, uint256 collateralWei, uint256 sicil) {
        addr = _members[id];
        (uint256 coll, uint256 s) = _account(id);
        collateralWei = coll * UNIT;
        sicil = s;
    }

    function accountOf(address merchant)
        external
        view
        returns (bool registered, uint256 id, uint256 collateralWei, uint256 sicil)
    {
        uint256 p = _idPlusOne[merchant];
        if (p == 0) return (false, 0, 0, 0);
        id = p - 1;
        (, collateralWei, sicil) = member(id);
        registered = true;
    }

    function invoice(uint256 index) public view returns (address debtor, address creditor, uint256 amountWei) {
        if (index >= _openInvoices) revert NoOpenInvoices();
        uint256 inv = (_invoices[index >> 1] >> ((index & 1) << 7)) & M128;
        debtor = _members[inv & M32];
        creditor = _members[(inv >> 32) & M32];
        amountWei = ((inv >> 64) & M64) * UNIT;
    }

    /// @notice Arayüz için sayfalı esnaf listesi.
    function membersPage(uint256 start, uint256 count)
        external
        view
        returns (address[] memory addrs, uint256[] memory collateralWei, uint256[] memory sicil)
    {
        uint256 n = _members.length;
        if (start > n) start = n;
        if (count > n - start) count = n - start;
        addrs = new address[](count);
        collateralWei = new uint256[](count);
        sicil = new uint256[](count);
        for (uint256 k; k < count; ++k) {
            (addrs[k], collateralWei[k], sicil[k]) = member(start + k);
        }
    }

    /// @notice Arayüz için sayfalı açık fatura listesi.
    function invoicesPage(uint256 start, uint256 count)
        external
        view
        returns (address[] memory debtors, address[] memory creditors, uint256[] memory amountsWei)
    {
        uint256 m = _openInvoices;
        if (start > m) start = m;
        if (count > m - start) count = m - start;
        debtors = new address[](count);
        creditors = new address[](count);
        amountsWei = new uint256[](count);
        for (uint256 k; k < count; ++k) {
            (debtors[k], creditors[k], amountsWei[k]) = invoice(start + k);
        }
    }

    // ───────────────────────────── iç yardımcılar ─────────────────────────────

    function _units(uint256 amountWei) internal pure returns (uint256) {
        if (amountWei % UNIT != 0) revert NotUnitMultiple();
        return amountWei / UNIT;
    }

    function _idOf(address a) internal view returns (uint256) {
        uint256 p = _idPlusOne[a];
        if (p == 0) revert NotRegistered();
        unchecked {
            return p - 1;
        }
    }

    function _setFee(uint256 feeWei) internal {
        uint256 units = _units(feeWei);
        if (units > MAX_FEE_UNITS) revert FeeTooHigh();
        // forge-lint: disable-next-line(unsafe-typecast)
        _feeUnits = uint64(units); // <= MAX_FEE_UNITS
        emit FeeChanged(feeWei);
    }

    function _addMember(address a, uint256 collUnits) internal returns (uint256 id) {
        id = _members.length;
        if (id > M32) revert TooManyMembers();
        if (collUnits > M64) revert AmountTooLarge();
        _members.push(a);
        _idPlusOne[a] = id + 1;
        if (id & 1 == 0) _accounts.push(collUnits);
        else _accounts[id >> 1] |= collUnits << 128;
    }

    function _account(uint256 id) internal view returns (uint256 coll, uint256 sicil) {
        uint256 half = _accounts[id >> 1] >> ((id & 1) << 7);
        coll = half & M64;
        sicil = (half >> 64) & M32;
    }

    function _setAccount(uint256 id, uint256 coll, uint256 sicil) internal {
        uint256 sh = (id & 1) << 7;
        uint256 k = id >> 1;
        _accounts[k] = (_accounts[k] & ~(M128 << sh)) | ((coll | (sicil << 64)) << sh);
    }

    function _addInvoice(uint256 d, uint256 c, uint256 units) internal {
        uint256 idx = _openInvoices;
        if (idx >= MAX_OPEN_INVOICES) revert TooManyInvoices();
        uint256 inv = d | (c << 32) | (units << 64);
        uint256 k = idx >> 1;
        if (idx & 1 == 0) {
            // yarım 0 yazılırken üst yarı (eski kayıt) temizlenir
            if (k == _invoices.length) _invoices.push(inv);
            else _invoices[k] = inv;
        } else {
            _invoices[k] |= inv << 128;
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        _openInvoices = uint32(idx + 1); // <= MAX_OPEN_INVOICES
    }

    function _send(address to, uint256 amountWei) internal {
        (bool ok,) = to.call{value: amountWei}("");
        if (!ok) revert TransferFailed();
    }
}
