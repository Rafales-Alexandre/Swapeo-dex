// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SwapeoLP is ERC20 {
    address public dex;

    modifier onlyDEX() {
        require(msg.sender == dex, "Only DEX");
        _;
    }

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        dex = msg.sender;
    }

    function mint(address to, uint256 amount) external onlyDEX {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyDEX {
        _burn(from, amount);
    }
}
