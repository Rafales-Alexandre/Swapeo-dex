// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockFeeOnTransferERC20 is ERC20 {
    uint256 public feeBps;
    constructor(string memory name, string memory symbol, uint8 decimals_, uint256 _feeBps) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000 ether);
        feeBps = _feeBps; // ex: 100 pour 1%
    }
    function mint(address to, uint256 amount) public {
    _mint(to, amount);
}
    function transfer(address recipient, uint256 amount) public override returns (bool) {
        uint256 fee = (amount * feeBps) / 10_000;
        uint256 sendAmount = amount - fee;
        require(super.transfer(recipient, sendAmount), "Transfer failed");
        if (fee > 0) require(super.transfer(address(0), fee), "Fee transfer failed");
        return true;
    }
    function transferFrom(address sender, address recipient, uint256 amount) public override returns (bool) {
        uint256 fee = (amount * feeBps) / 10_000;
        uint256 sendAmount = amount - fee;
        require(super.transferFrom(sender, recipient, sendAmount), "TransferFrom failed");
        if (fee > 0) require(super.transferFrom(sender, address(0), fee), "FeeFrom transfer failed");
        return true;
    }
}
