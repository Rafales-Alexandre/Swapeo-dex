// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Centralized error definitions for Swapeo contracts.
error ZeroAddress();
error IdenticalTokens();
error InsufficientAmounts();
error InvalidRatio();
error NoLiquidity();
error InsufficientLiquidity();
error InsufficientInitialLiquidity();
error AmountOutExceedsReserveA();
error AmountOutExceedsReserveB();
error ReserveAOverflow();
error ReserveBOverflow();
error HighSlippage();
error UseForward();
error NoFees();
error UnexistingPair();
error InvalidFee();
