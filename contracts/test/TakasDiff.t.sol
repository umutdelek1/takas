// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Takas} from "../src/Takas.sol";

/// @notice Rastgele senaryolarda kontratı JS referansıyla (test/js/takas-ref.cjs) birebir karşılaştırır.
contract TakasDiffTest is Test {
    uint256 constant BASE = 0xA000;

    Takas t;
    uint256[] data;
    uint256 p; // data okuma imleci
    uint256 unit;

    function _next() internal returns (uint256 v) {
        v = data[p++];
    }

    function _addr(uint256 i) internal pure returns (address) {
        return address(uint160(BASE + i));
    }

    function _id(address a) internal pure returns (uint256) {
        return uint256(uint160(a)) - BASE;
    }

    function _readInvoices(uint256 n) internal {
        uint256 m = _next();
        for (uint256 k; k < m; ++k) {
            uint256 d = _next();
            uint256 c = _next();
            uint256 a = _next();
            require(d < n && c < n, "senaryo");
            vm.prank(_addr(d));
            t.owe(_addr(c), a * unit);
        }
    }

    function _checkSession(uint256 n, bool run) internal {
        Takas.SettleStats memory s;
        if (run) {
            Takas.SettleStats memory pv = t.previewSettle();
            s = t.settle();
            assertEq(pv.invoices, s.invoices, "preview invoices");
            assertEq(pv.excluded, s.excluded, "preview excluded");
            assertEq(pv.participants, s.participants, "preview participants");
            assertEq(pv.grossWei, s.grossWei, "preview gross");
            assertEq(pv.cashWei, s.cashWei, "preview cash");
            assertEq(pv.feesWei, s.feesWei, "preview fees");
        }
        assertEq(s.invoices, _next(), "invoices");
        assertEq(s.participants, _next(), "participants");
        assertEq(s.excluded, _next(), "excluded");
        assertEq(s.grossWei, _next() * unit, "gross");
        assertEq(s.cashWei, _next() * unit, "cash");
        assertEq(s.feesWei, _next() * unit, "fees");
        assertEq(s.savedWei, s.grossWei - s.cashWei, "saved");

        uint256 rem = _next();
        assertEq(t.openInvoiceCount(), rem, "kalan fatura");
        for (uint256 k; k < rem; ++k) {
            (address d, address c, uint256 a) = t.invoice(k);
            assertEq(_id(d), _next(), "kalan borclu");
            assertEq(_id(c), _next(), "kalan alacakli");
            assertEq(a, _next() * unit, "kalan tutar");
        }
        for (uint256 i; i < n; ++i) {
            (, uint256 coll,) = t.member(i);
            assertEq(coll, _next() * unit, "teminat");
        }
        for (uint256 i; i < n; ++i) {
            (,, uint256 sicil) = t.member(i);
            assertEq(sicil, _next(), "sicil");
        }
        assertEq(t.totalCollateral() + t.feeBalance(), address(t).balance, "teminat + kasa == bakiye");
    }

    /// forge-config: default.fuzz.runs = 200
    function testFuzz_MatchesJsReference(uint32 seed) public {
        string[] memory cmd = new string[](3);
        cmd[0] = "node";
        cmd[1] = "test/js/takas-ref.cjs";
        cmd[2] = vm.toString(uint256(seed));
        data = abi.decode(vm.ffi(cmd), (uint256[]));
        p = 0;

        uint256 n = _next();
        uint256 feeUnits = _next();
        t = new Takas(0);
        unit = t.UNIT();
        t.setFee(feeUnits * unit);
        for (uint256 i; i < n; ++i) {
            uint256 coll = _next() * unit;
            vm.deal(_addr(i), coll + 1000 ether);
            vm.prank(_addr(i));
            t.register{value: coll}();
        }
        _readInvoices(n);
        uint256[] memory topup = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            topup[i] = _next();
        }
        uint256 p2 = p; // ikinci fatura grubu, ilk seanstan sonra eklenecek
        uint256 m2 = data[p];
        p += 1 + 3 * m2;

        _checkSession(n, true);

        for (uint256 i; i < n; ++i) {
            if (topup[i] == 0) continue;
            vm.prank(_addr(i));
            t.deposit{value: topup[i] * unit}();
        }
        uint256 after1 = p;
        p = p2;
        _readInvoices(n);
        p = after1;

        _checkSession(n, t.openInvoiceCount() != 0);
        assertEq(p, data.length, "tum veri okundu");
    }
}
