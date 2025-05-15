// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockUniswapRouter {
    address public tokenA;
    address public tokenB;
    IERC20 public tokenContractA;
    IERC20 public tokenContractB;

    function setTokens(address _tokenA, address _tokenB) external {
        tokenA = _tokenA;
        tokenB = _tokenB;
        tokenContractA = IERC20(_tokenA);
        tokenContractB = IERC20(_tokenB);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 
    ) external returns (uint256[] memory amounts) {
        require(amountIn > 0, "Invalid amount");
        require(path.length >= 2
             && path[0] != address(0)
             && path[1] != address(0),
             "Invalid path");

        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[1] = amountIn;
        require(amounts[1] >= amountOutMin, "Slippage too high");

        IERC20(path[1]).transfer(to, amounts[1]);
    }
}
