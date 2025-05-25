// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20RevertOnTransfer is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);  
    }
    function transfer(address, uint256) public pure override returns (bool) {
        revert("ERC20 transfer always reverts");
    }
    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert("ERC20 transferFrom always reverts");
    }
}
