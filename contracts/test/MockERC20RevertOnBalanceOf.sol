// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20RevertOnBalanceOf is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function balanceOf(address /* account */) public view override returns (uint256) {
        revert("balanceOf always reverts");
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}
