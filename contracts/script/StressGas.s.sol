// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TakasStress} from "../src/TakasStress.sol";

/// @notice Yerel anvil'de settle() gas ölçümü. Özel anahtar gerekmez:
///   anvil --gas-limit 1000000000
///   forge script script/StressGas.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
/// Gerçek işlem gas'ı broadcast/StressGas.s.sol/<chainid>/run-latest.json makbuzlarında.
contract StressGas is Script {
    function run() external {
        uint256[3] memory sizes = [uint256(100), 500, 1000];
        for (uint256 k; k < sizes.length; ++k) {
            uint256 n = sizes[k];
            vm.startBroadcast();
            TakasStress t = new TakasStress(0.0005 ether);
            for (uint256 done; done < n; done += 250) {
                t.seedMerchants(n - done < 250 ? n - done : 250, 10 ether);
            }
            for (uint256 done; done < 3 * n; done += 500) {
                t.seedInvoices(3 * n - done < 500 ? 3 * n - done : 500, 1 ether, n + done);
            }
            t.settle();
            vm.stopBroadcast();
            console.log("esnaf", n, "fatura", 3 * n);
        }
    }
}
