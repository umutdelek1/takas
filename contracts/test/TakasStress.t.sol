// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Takas} from "../src/Takas.sol";
import {TakasStress} from "../src/TakasStress.sol";

contract TakasStressTest is Test {
    TakasStress t;

    function setUp() public {
        t = new TakasStress(0.0005 ether);
    }

    function test_StressModeBlocksMoney() public {
        vm.expectRevert(TakasStress.StressMode.selector);
        t.register{value: 1 ether}();
        vm.expectRevert(TakasStress.StressMode.selector);
        t.withdraw(1 ether);
        vm.expectRevert(TakasStress.StressMode.selector);
        t.withdrawFees();
        vm.prank(address(0xBEEF));
        vm.expectRevert(Takas.NotOwner.selector);
        t.seedMerchants(1, 1 ether);
    }

    function test_RingClosesWithoutCash() public {
        t.seedMerchants(100, 1 ether);
        t.seedRing(5 ether);
        Takas.SettleStats memory s = t.settle();
        assertEq(s.invoices, 100);
        assertEq(s.cashWei, 0);
        assertEq(s.excluded, 0);
        assertEq(s.savedWei, 500 ether);
        assertEq(t.feeBalance(), 100 * 0.0005 ether);
    }

    function _measure(uint256 merchants, uint256 invoicesPerMerchant) internal returns (uint256 gasUsed) {
        t = new TakasStress(0.0005 ether);
        t.seedMerchants(merchants, 10 ether);
        t.seedInvoices(merchants * invoicesPerMerchant, 1 ether, merchants);
        uint256 g = gasleft();
        Takas.SettleStats memory s = t.settle();
        gasUsed = g - gasleft();
        console.log("esnaf", merchants, "fatura", s.invoices);
        console.log("  settle gas", gasUsed, "esnaf basina", gasUsed / merchants);
        console.log("  fatura basina", gasUsed / s.invoices, "tasarruf %", s.savedWei * 100 / s.grossWei);
    }

    function test_GasScaling() public {
        _measure(50, 3);
        _measure(200, 3);
        _measure(1000, 3);
    }
}
