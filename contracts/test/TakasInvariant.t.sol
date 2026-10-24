// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Takas} from "../src/Takas.sol";

/// @dev Rastgele kayıt / yatırma / çekme / fatura / takas / ücret çekme dizileri üretir.
contract Handler is Test {
    Takas public t;
    address[] public actors;
    uint256 unit;

    constructor() {
        t = new Takas(0.0005 ether); // kurucu Handler: setFee / withdrawFees çağırabilir
        unit = t.UNIT();
        for (uint256 i; i < 6; ++i) {
            address a = address(uint160(0xB000 + i));
            actors.push(a);
            vm.deal(a, 1_000_000 ether);
        }
    }

    receive() external payable {}

    function _actor(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    function _ensure(address a, uint256 amt) internal {
        (bool reg,,,) = t.accountOf(a);
        if (reg) return;
        vm.prank(a);
        t.register{value: amt}();
    }

    function register(uint256 s, uint256 amt) external {
        _ensure(_actor(s), bound(amt, 0, 50) * 0.1 ether);
    }

    function deposit(uint256 s, uint256 amt) external {
        address a = _actor(s);
        _ensure(a, 0);
        amt = bound(amt, 1, 50) * 0.1 ether;
        vm.prank(a);
        t.deposit{value: amt}();
    }
    function withdraw(uint256 s, uint256 amt) external {
        address a = _actor(s);
        (,, uint256 coll,) = t.accountOf(a);
        if (coll == 0) return;
        amt = (bound(amt, 1, coll) / unit) * unit;
        if (amt == 0) return;
        vm.prank(a);
        t.withdraw(amt);
    }

    function owe(uint256 s1, uint256 s2, uint256 amt) external {
        address d = _actor(s1);
        address c = _actor(s2 + (s2 % actors.length == s1 % actors.length ? 1 : 0));
        _ensure(d, 0);
        _ensure(c, 0);
        amt = bound(amt, 1, 30) * 0.1 ether;
        vm.prank(d);
        t.owe(c, amt);
    }

    function settle() external {
        if (t.openInvoiceCount() == 0) return;
        t.settle();
    }

    function setFee(uint256 f) external {
        t.setFee(bound(f, 0, 2000) * unit);
    }

    function withdrawFees() external {
        if (t.feeBalance() == 0) return;
        t.withdrawFees();
    }
}

contract TakasInvariantTest is Test {
    Takas t;
    Handler h;

    function setUp() public {
        h = new Handler();
        t = h.t();
        targetContract(address(h));
    }

    /// teminat toplamı + kasa = kontrat bakiyesi
    function invariant_Solvent() public view {
        assertEq(t.totalCollateral() + t.feeBalance(), address(t).balance);
    }

    /// her hesap okunabilir ve toplam bakiyeyi aşmaz (negatif/taşma yok)
    function invariant_NoNegativeBalance() public view {
        uint256 n = t.memberCount();
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            (, uint256 c,) = t.member(i);
            sum += c;
            assertLe(c, address(t).balance);
        }
        assertLe(sum, address(t).balance);
    }
}
