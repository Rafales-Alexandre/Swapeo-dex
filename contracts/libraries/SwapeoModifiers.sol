// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { 
    ZeroAddress,
    IdenticalTokens,
    InsufficientAmounts
} from "./SwapeoErrors.sol";

abstract contract SwapeoModifiers {
    modifier validTokenPair(address tokenA, address tokenB) {
        if (tokenA == address(0) || tokenB == address(0)) revert ZeroAddress();
        if (tokenA == tokenB) revert IdenticalTokens();
        _;
    }

    modifier nonZeroAmount(uint256 amount) {
        if (amount == 0) revert InsufficientAmounts();
        _;
    }

    modifier validSwapTokens(address inputToken, address outputToken) {
        if (inputToken == address(0) || outputToken == address(0)) revert ZeroAddress();
        if (inputToken == outputToken) revert IdenticalTokens();
        _;
    }

    modifier notIdenticalTokens(address tokenA, address tokenB) {
        if (tokenA == tokenB) revert IdenticalTokens();
        _;
    }
}
