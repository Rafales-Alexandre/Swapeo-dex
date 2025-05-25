// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISwapeoDEX {
    function withdraw(address, address, uint256) external;
}

contract ReentrantAttacker {
    ISwapeoDEX public swapeo;
    address public tokenA;
    address public tokenB;
    uint256 public withdrawAmount;
    uint256 public calls;
    bool public attackStarted;

    constructor(address _swapeo, address _tokenA, address _tokenB, uint256 _withdrawAmount) {
        swapeo = ISwapeoDEX(_swapeo);
        tokenA = _tokenA;
        tokenB = _tokenB;
        withdrawAmount = _withdrawAmount;
    }

    function startAttack() external {
    attackStarted = true;
    calls = 0;
    swapeo.withdraw(tokenA, tokenB, withdrawAmount);
}
receive() external payable {
    calls += 1;
    if (attackStarted) {
        attackStarted = false;
        
        try swapeo.withdraw(tokenA, tokenB, withdrawAmount) {
        } catch {}
    }
}
    
}
