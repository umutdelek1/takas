// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Takas} from "../src/Takas.sol";

contract TakasTest is Test {
    Takas t;
    address owner = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");

    uint256 constant FEE = 0.0005 ether;

    receive() external payable {}

    function setUp() public {
        t = new Takas(0);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
        vm.deal(dave, 100 ether);
    }

    // ───────── yardımcılar ─────────

    function _reg(address who, uint256 coll) internal {
        vm.prank(who);
        t.register{value: coll}();
    }

    function _owe(address debtor, address creditor, uint256 amount) internal {
        vm.prank(debtor);
        t.owe(creditor, amount);
    }

    function _coll(address who) internal view returns (uint256 c) {
        (,, c,) = t.accountOf(who);
    }

    function _sicil(address who) internal view returns (uint256 s) {
        (,,, s) = t.accountOf(who);
    }

    function _assertSolvent() internal view {
        assertEq(t.totalCollateral() + t.feeBalance(), address(t).balance, "teminat + kasa == bakiye");
    }

    function _eqStats(Takas.SettleStats memory a, Takas.SettleStats memory b) internal pure {
        assertEq(a.invoices, b.invoices, "invoices");
        assertEq(a.participants, b.participants, "participants");
        assertEq(a.excluded, b.excluded, "excluded");
        assertEq(a.grossWei, b.grossWei, "gross");
        assertEq(a.cashWei, b.cashWei, "cash");
        assertEq(a.savedWei, b.savedWei, "saved");
        assertEq(a.feesWei, b.feesWei, "fees");
    }

    // ───────── takas ─────────

    function test_CycleClosesWithoutCash() public {
        _reg(alice, 0);
        _reg(bob, 0);
        _reg(carol, 0);
        _owe(alice, bob, 100 ether);
        _owe(bob, carol, 100 ether);
        _owe(carol, alice, 100 ether);

        Takas.SettleStats memory p = t.previewSettle();
        Takas.SettleStats memory s = t.settle();
        _eqStats(p, s);

        assertEq(s.invoices, 3);
        assertEq(s.participants, 3);
        assertEq(s.excluded, 0);
        assertEq(s.grossWei, 300 ether);
        assertEq(s.cashWei, 0);
        assertEq(s.savedWei, 300 ether);
        assertEq(t.openInvoiceCount(), 0);
        assertEq(_sicil(alice), 1);
        assertEq(t.session(), 1);
        _assertSolvent();
    }

    function test_NetDebtPaidFromCollateral() public {
        _reg(alice, 10 ether);
        _reg(bob, 1 ether);
        _owe(alice, bob, 7 ether);
        _owe(bob, alice, 3 ether);

        Takas.SettleStats memory s = t.settle();
        assertEq(s.grossWei, 10 ether);
        assertEq(s.cashWei, 4 ether);
        assertEq(s.savedWei, 6 ether);
        assertEq(_coll(alice), 6 ether);
        assertEq(_coll(bob), 5 ether);

        // net alacaklı parasını çekebilir
        uint256 before = bob.balance;
        vm.prank(bob);
        t.withdraw(5 ether);
        assertEq(bob.balance - before, 5 ether);
        assertEq(_coll(bob), 0);
        _assertSolvent();
    }

    function test_ExclusionCascadesAndClosesNextSession() public {
        _reg(alice, 5 ether); // 10 borçlu, yetmez
        _reg(bob, 0); // A'dan 10 alır, C'ye 8 öder → A dışlanınca 8 net borç, teminat 0
        _reg(carol, 0);
        _reg(dave, 1 ether);
        _owe(alice, bob, 10 ether);
        _owe(bob, carol, 8 ether);
        _owe(dave, carol, 1 ether); // bağımsız, kapanmalı

        Takas.SettleStats memory p = t.previewSettle();
        Takas.SettleStats memory s = t.settle();
        _eqStats(p, s);
        assertEq(s.excluded, 2, "alice + bob");
        assertEq(s.invoices, 1);
        assertEq(s.participants, 2, "dave + carol");
        assertEq(t.openInvoiceCount(), 2);
        (address d0, address c0, uint256 a0) = t.invoice(0);
        (address d1, address c1, uint256 a1) = t.invoice(1);
        assertEq(d0, alice);
        assertEq(c0, bob);
        assertEq(a0, 10 ether);
        assertEq(d1, bob);
        assertEq(c1, carol);
        assertEq(a1, 8 ether);
        assertEq(_coll(alice), 5 ether, "dislanana dokunulmaz");
        assertEq(_coll(carol), 1 ether);
        assertEq(_sicil(dave), 1);
        assertEq(_sicil(alice), 0);

        // teminat tamamlanınca sonraki seansta kapanır
        vm.prank(alice);
        t.deposit{value: 5 ether}();
        s = t.settle();
        assertEq(s.excluded, 0);
        assertEq(s.invoices, 2);
        assertEq(s.cashWei, 10 ether, "alice 10 oder; bob 10 alir 8 oder");
        assertEq(t.openInvoiceCount(), 0);
        assertEq(_coll(alice), 0);
        assertEq(_coll(bob), 2 ether);
        assertEq(_coll(carol), 9 ether);
        assertEq(_sicil(bob), 1);
        assertEq(t.session(), 2);
        _assertSolvent();
    }

    function test_FeeDeductedIntoTreasury() public {
        t.setFee(FEE);
        _reg(alice, 1 ether);
        _reg(bob, 1 ether);
        _reg(carol, 1 ether);
        _owe(alice, bob, 2 ether);
        _owe(bob, carol, 2 ether);
        _owe(carol, alice, 2 ether);
        _owe(alice, carol, 0.5 ether);

        Takas.SettleStats memory s = t.settle();
        assertEq(s.feesWei, 4 * FEE);
        assertEq(t.feeBalance(), 4 * FEE);
        assertEq(_coll(alice), 1 ether - 0.5 ether - 2 * FEE);
        assertEq(_coll(bob), 1 ether - FEE);
        assertEq(_coll(carol), 1 ether + 0.5 ether - FEE);
        _assertSolvent();
    }

    function test_FeeCausesExclusion() public {
        t.setFee(FEE);
        _reg(alice, 1 ether); // net borç tam 1 MON, ücret yetmez
        _reg(bob, 0);
        _owe(alice, bob, 1 ether);

        Takas.SettleStats memory s = t.settle();
        assertEq(s.excluded, 1);
        assertEq(s.invoices, 0);
        assertEq(t.openInvoiceCount(), 1);
        assertEq(t.feeBalance(), 0);

        vm.prank(alice);
        t.deposit{value: FEE}();
        s = t.settle();
        assertEq(s.invoices, 1);
        assertEq(_coll(alice), 0);
        assertEq(_coll(bob), 1 ether);
        assertEq(t.feeBalance(), FEE);
        _assertSolvent();
    }

    function test_CreditorWithZeroCollateralPaysFeeExcluded() public {
        // alacaklı da borç faturası kapatırsa ücreti teminattan öder
        t.setFee(FEE);
        _reg(alice, 0);
        _reg(bob, 0);
        _owe(alice, bob, 1 ether);
        _owe(bob, alice, 1 ether);
        Takas.SettleStats memory s = t.settle();
        assertEq(s.excluded, 2);
        assertEq(t.openInvoiceCount(), 2);
    }

    function test_WithdrawFees() public {
        t.setFee(FEE);
        _reg(alice, 1 ether);
        _reg(bob, 1 ether);
        _owe(alice, bob, 0.1 ether);
        t.settle();

        vm.prank(alice);
        vm.expectRevert(Takas.NotOwner.selector);
        t.withdrawFees();

        uint256 before = owner.balance;
        t.withdrawFees();
        assertEq(owner.balance - before, FEE);
        assertEq(t.feeBalance(), 0);
        _assertSolvent();

        vm.expectRevert(Takas.ZeroAmount.selector);
        t.withdrawFees();
    }

    function test_SettleOrderPreservedForDeferred() public {
        _reg(alice, 0);
        _reg(bob, 10 ether);
        _reg(carol, 10 ether);
        _owe(alice, bob, 1 ether); // dışlanır
        _owe(bob, carol, 1 ether); // kapanır
        _owe(alice, carol, 2 ether); // dışlanır
        _owe(carol, bob, 3 ether); // kapanır
        _owe(alice, bob, 4 ether); // dışlanır
        t.settle();
        assertEq(t.openInvoiceCount(), 3);
        (,, uint256 a0) = t.invoice(0);
        (,, uint256 a1) = t.invoice(1);
        (,, uint256 a2) = t.invoice(2);
        assertEq(a0, 1 ether);
        assertEq(a1, 2 ether);
        assertEq(a2, 4 ether);
        // yeni fatura yeniden kullanılan slota doğru eklenir
        _owe(bob, carol, 5 ether);
        assertEq(t.openInvoiceCount(), 4);
        (address d3, address c3, uint256 a3) = t.invoice(3);
        assertEq(d3, bob);
        assertEq(c3, carol);
        assertEq(a3, 5 ether);
        (,, a2) = t.invoice(2);
        assertEq(a2, 4 ether);
    }

    function test_Pages() public {
        _reg(alice, 1 ether);
        _reg(bob, 2 ether);
        _reg(carol, 3 ether);
        _owe(alice, bob, 1 ether);
        _owe(carol, bob, 2 ether);
        (address[] memory addrs, uint256[] memory colls,) = t.membersPage(1, 10);
        assertEq(addrs.length, 2);
        assertEq(addrs[0], bob);
        assertEq(colls[1], 3 ether);
        (address[] memory ds,, uint256[] memory as_) = t.invoicesPage(0, 10);
        assertEq(ds.length, 2);
        assertEq(ds[1], carol);
        assertEq(as_[0], 1 ether);
    }

    // ───────── hatalı girişler ─────────

    function test_RevertRegisterTwice() public {
        _reg(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(Takas.AlreadyRegistered.selector);
        t.register{value: 1 ether}();
    }

    function test_RevertNonUnitAmounts() public {
        vm.prank(alice);
        vm.expectRevert(Takas.NotUnitMultiple.selector);
        t.register{value: 1}();
        _reg(alice, 1 ether);
        _reg(bob, 0);
        vm.prank(alice);
        vm.expectRevert(Takas.NotUnitMultiple.selector);
        t.owe(bob, 1 ether + 1);
        vm.prank(alice);
        vm.expectRevert(Takas.NotUnitMultiple.selector);
        t.withdraw(1);
    }

    function test_RevertOweErrors() public {
        _reg(alice, 1 ether);
        vm.prank(bob);
        vm.expectRevert(Takas.NotRegistered.selector);
        t.owe(alice, 1 ether); // borçlu kayıtsız
        vm.prank(alice);
        vm.expectRevert(Takas.NotRegistered.selector);
        t.owe(bob, 1 ether); // alacaklı kayıtsız
        vm.prank(alice);
        vm.expectRevert(Takas.SelfInvoice.selector);
        t.owe(alice, 1 ether);
        _reg(bob, 0);
        vm.prank(alice);
        vm.expectRevert(Takas.ZeroAmount.selector);
        t.owe(bob, 0);
        uint256 tooBig = (t.MAX_INVOICE_UNITS() + 1) * t.UNIT();
        vm.prank(alice);
        vm.expectRevert(Takas.AmountTooLarge.selector);
        t.owe(bob, tooBig);
    }

    function test_RevertCollateralErrors() public {
        vm.prank(alice);
        vm.expectRevert(Takas.NotRegistered.selector);
        t.deposit{value: 1 ether}();
        _reg(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(Takas.ZeroAmount.selector);
        t.deposit{value: 0}();
        vm.prank(alice);
        vm.expectRevert(Takas.InsufficientCollateral.selector);
        t.withdraw(2 ether);
        vm.prank(alice);
        vm.expectRevert(Takas.ZeroAmount.selector);
        t.withdraw(0);
        vm.prank(bob);
        vm.expectRevert(Takas.NotRegistered.selector);
        t.withdraw(1 ether);
    }

    function test_RevertOwnerOnlyAndFeeLimits() public {
        vm.prank(alice);
        vm.expectRevert(Takas.NotOwner.selector);
        t.setFee(FEE);
        uint256 tooHigh = 1 ether + t.UNIT();
        vm.expectRevert(Takas.FeeTooHigh.selector);
        t.setFee(tooHigh);
        vm.expectRevert(Takas.NotUnitMultiple.selector);
        t.setFee(1);
        t.setFee(FEE);
        assertEq(t.fee(), FEE);
    }

    function test_RevertSettleEmpty() public {
        vm.expectRevert(Takas.NoOpenInvoices.selector);
        t.settle();
        Takas.SettleStats memory p = t.previewSettle();
        assertEq(p.invoices, 0);
    }

    function test_RevertInvoiceOutOfRange() public {
        vm.expectRevert(Takas.NoOpenInvoices.selector);
        t.invoice(0);
    }
}
