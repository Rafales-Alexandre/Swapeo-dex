// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20RevertOnWithdraw is ERC20 {
    bool public failNextTransfer;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {}

    function setFailNextTransfer(bool _fail) external {
        failNextTransfer = _fail;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(!failNextTransfer, "Transfer failed intentionally");
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(!failNextTransfer, "Transfer failed intentionally");
        return super.transferFrom(from, to, amount);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
