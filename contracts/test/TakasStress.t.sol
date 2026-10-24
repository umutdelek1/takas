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

    function _collateral(uint256 id) internal view returns (uint256 c) {
        (, c,) = t.member(id);
    }

    function test_PayrollPaysEveryWorkerInOneSettle() public {
        t.seedPayroll(2.2 ether, 200, 0.01 ether);
        assertEq(t.memberCount(), 201);
        assertEq(t.openInvoiceCount(), 200);

        Takas.SettleStats memory p = t.previewSettle();
        Takas.SettleStats memory s = t.settle();
        assertEq(s.invoices, p.invoices);
        assertEq(s.invoices, 200);
        assertEq(s.participants, 201, "sirket + 200 calisan");
        assertEq(s.excluded, 0);
        assertEq(s.grossWei, 2 ether, "toplam maas");
        assertEq(s.cashWei, 2 ether);
        assertEq(s.feesWei, 200 * 0.0005 ether);
        assertEq(t.openInvoiceCount(), 0);

        // sirket: 2,2 - 2,0 maas - 0,1 ucret
        assertEq(_collateral(0), 0.1 ether);
        // ilk, orta ve son calisan (cift/tek hesap yarilari)
        assertEq(_collateral(1), 0.01 ether);
        assertEq(_collateral(100), 0.01 ether);
        assertEq(_collateral(101), 0.01 ether);
        assertEq(_collateral(200), 0.01 ether);
        assertEq(t.feeBalance(), 0.1 ether);
    }

    function test_PayrollAfterOddNumberOfMerchants() public {
        t.seedMerchants(3, 1 ether); // hesap sayisi tek: calisanlar bir yarim slotta baslar
        t.seedPayroll(1 ether, 7, 0.05 ether);
        assertEq(t.memberCount(), 3 + 1 + 7);
        assertEq(_collateral(3), 1 ether, "sirket");
        assertEq(_collateral(4), 0);
        assertEq(_collateral(10), 0);
        (address d, address c, uint256 a) = t.invoice(0);
        assertEq(d, address(0));
        assertEq(c, address(0));
        assertEq(a, 0.05 ether);

        Takas.SettleStats memory s = t.settle();
        assertEq(s.invoices, 7);
        assertEq(s.excluded, 0);
        assertEq(_collateral(3), 1 ether - 7 * 0.05 ether - 7 * 0.0005 ether);
        assertEq(_collateral(10), 0.05 ether);
        assertEq(_collateral(0), 1 ether, "diger esnafa dokunulmaz");
    }

    function test_PayrollCompanyWithoutEnoughCollateralIsExcluded() public {
        t.seedPayroll(1 ether, 100, 0.05 ether); // 5 MON maas, 1 MON teminat
        Takas.SettleStats memory s = t.settle();
        assertEq(s.excluded, 1);
        assertEq(s.invoices, 0);
        assertEq(t.openInvoiceCount(), 100, "hicbir maas odenmez");
        assertEq(_collateral(0), 1 ether);
    }

    function test_PayrollRevertsOnBadInput() public {
        vm.expectRevert(Takas.ZeroAmount.selector);
        t.seedPayroll(1 ether, 0, 0.01 ether);
        vm.expectRevert(Takas.ZeroAmount.selector);
        t.seedPayroll(1 ether, 5, 0);
        vm.expectRevert(Takas.NotUnitMultiple.selector);
        t.seedPayroll(1 ether, 5, 1);
        vm.prank(address(0xBEEF));
        vm.expectRevert(Takas.NotOwner.selector);
        t.seedPayroll(1 ether, 5, 0.01 ether);
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
