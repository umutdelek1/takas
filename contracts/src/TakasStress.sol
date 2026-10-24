// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Takas} from "./Takas.sol";

/// @title TakasStress — settle() ölçümü için sentetik esnaf ve fatura üreten sürüm
/// @notice Teminatlar sentetiktir (gerçek MON yoktur); bu yüzden para yatırma ve çekme kapalı.
contract TakasStress is Takas {
    error StressMode();

    constructor(uint256 feeWei) Takas(feeWei) {}

    /// @notice `count` sentetik esnaf ekler, her birine `collateralWei` sentetik teminat verir.
    function seedMerchants(uint256 count, uint256 collateralWei) external onlyOwner {
        uint256 units = _units(collateralWei);
        uint256 start = _members.length;
        for (uint256 k; k < count; ++k) {
            address a = address(uint160(uint256(keccak256(abi.encode(address(this), start + k)))));
            _addMember(a, units);
        }
    }

    /// @notice `count` rastgele fatura (1..maxAmountWei) ekler.
    function seedInvoices(uint256 count, uint256 maxAmountWei, uint256 seed) external onlyOwner {
        uint256 n = _members.length;
        if (n < 2) revert NotRegistered();
        uint256 maxUnits = _units(maxAmountWei);
        if (maxUnits == 0) revert ZeroAmount();
        if (maxUnits > MAX_INVOICE_UNITS) revert AmountTooLarge();
        for (uint256 k; k < count; ++k) {
            uint256 r = uint256(keccak256(abi.encode(seed, k)));
            uint256 d = r % n;
            uint256 c = (r >> 64) % (n - 1);
            if (c >= d) ++c;
            _addInvoice(d, c, 1 + ((r >> 128) % maxUnits));
        }
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
