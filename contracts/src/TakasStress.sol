// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Takas} from "./Takas.sol";

/// @title TakasStress — settle() ölçümü için sentetik esnaf ve fatura üreten sürüm
/// @notice Teminatlar sentetiktir (gerçek MON yoktur); bu yüzden para yatırma ve çekme kapalı.
contract TakasStress is Takas {
    error StressMode();

    constructor(uint256 feeWei) Takas(feeWei) {}

    /// @notice `count` sentetik esnaf ekler, her birine `collateralWei` sentetik teminat verir.
    /// @dev Adres kaydı yazılmaz (yalnızca dizi uzunluğu büyür): settle() esnaf adreslerini okumaz,
    ///      yalnızca `_members.length` ve `_accounts` kelimelerini okur. Böylece ölçüm tohumlaması ucuz kalır.
    function seedMerchants(uint256 count, uint256 collateralWei) external onlyOwner {
        uint256 units = _units(collateralWei);
        if (units > M64) revert AmountTooLarge();
        uint256 start = _members.length;
        uint256 end = start + count;
        if (end > M32) revert TooManyMembers();
        assembly ("memory-safe") {
            sstore(_members.slot, end)
        }
        uint256 id = start;
        if (id & 1 == 1 && id < end) {
            _accounts[id >> 1] |= units << 128;
            ++id;
        }
        for (; id + 1 < end; id += 2) {
            _accounts.push(units | (units << 128));
        }
        if (id < end) _accounts.push(units);
    }

    /// @notice `count` rastgele fatura (1..maxAmountWei) ekler.
    function seedInvoices(uint256 count, uint256 maxAmountWei, uint256 seed) external onlyOwner {
        uint256 n = _members.length;
        if (n < 2) revert NotRegistered();
        uint256 maxUnits = _units(maxAmountWei);
        if (maxUnits == 0) revert ZeroAmount();
        if (maxUnits > MAX_INVOICE_UNITS) revert AmountTooLarge();
        uint256 idx = _openInvoices;
        for (uint256 k; k < count; ++k) {
            uint256 r = uint256(keccak256(abi.encode(seed, k)));
            uint256 d = r % n;
            uint256 c = (r >> 64) % (n - 1);
            if (c >= d) ++c;
            uint256 inv = d | (c << 32) | ((1 + ((r >> 128) % maxUnits)) << 64);
            if (idx & 1 == 0) {
                if (idx >> 1 == _invoices.length) _invoices.push(inv);
                else _invoices[idx >> 1] = inv;
            } else {
                _invoices[idx >> 1] |= inv << 128;
            }
            ++idx;
        }
        if (idx > MAX_OPEN_INVOICES) revert TooManyInvoices();
        // forge-lint: disable-next-line(unsafe-typecast)
        _openInvoices = uint32(idx);
    }

    /// @notice Halka biçiminde fatura ekler: i → i+1 (mod n), hepsi aynı tutar. Nakitsiz kapanır.
    function seedRing(uint256 amountWei) external onlyOwner {
        uint256 n = _members.length;
        uint256 units = _units(amountWei);
        if (units == 0) revert ZeroAmount();
        for (uint256 i; i < n; ++i) {
            _addInvoice(i, i + 1 == n ? 0 : i + 1, units);
        }
    }

    /// @notice "Maaş günü": 1 şirket ve `workers` çalışan hesabı açar; şirket her çalışana `salaryWei`
    ///         tutarında bir maaş faturası yazar. Şirkete `companyCollateralWei` sentetik teminat verilir,
    ///         çalışanların teminatı 0'dır. Fatura sırası: şirket → çalışan 1..N.
    function seedPayroll(uint256 companyCollateralWei, uint256 workers, uint256 salaryWei) external onlyOwner {
        if (workers == 0) revert ZeroAmount();
        uint256 collUnits = _units(companyCollateralWei);
        uint256 salary = _units(salaryWei);
        if (salary == 0) revert ZeroAmount();
        if (salary > MAX_INVOICE_UNITS || collUnits > M64) revert AmountTooLarge();
        uint256 idx = _openInvoices;
        if (idx + workers > MAX_OPEN_INVOICES) revert TooManyInvoices();

        uint256 company = _appendAccounts(1, collUnits);
        _appendAccounts(workers, 0);
        for (uint256 k; k < workers; ++k) {
            uint256 inv = company | ((company + 1 + k) << 32) | (salary << 64);
            if (idx & 1 == 0) {
                if (idx >> 1 == _invoices.length) _invoices.push(inv);
                else _invoices[idx >> 1] = inv;
            } else {
                _invoices[idx >> 1] |= inv << 128;
            }
            ++idx;
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        _openInvoices = uint32(idx);
    }

    /// @dev `count` hesabı sonuna ekler (adres yazılmaz), hepsine `units` teminat verir; ilk numarayı döndürür.
    function _appendAccounts(uint256 count, uint256 units) internal returns (uint256 start) {
        start = _members.length;
        uint256 end = start + count;
        if (end > M32) revert TooManyMembers();
        assembly ("memory-safe") {
            sstore(_members.slot, end)
        }
        uint256 id = start;
        if (id & 1 == 1 && id < end) {
            _accounts[id >> 1] |= units << 128;
            ++id;
        }
        for (; id + 1 < end; id += 2) {
            _accounts.push(units | (units << 128));
        }
        if (id < end) _accounts.push(units);
    }

    function register() external payable override {
        revert StressMode();
    }

    function deposit() external payable override {
        revert StressMode();
    }

    function withdraw(uint256) external pure override {
        revert StressMode();
    }

    function withdrawFees() external pure override {
        revert StressMode();
    }
}
