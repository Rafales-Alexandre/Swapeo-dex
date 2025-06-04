// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISwapeoDEX {
    event Deposit(
        address indexed provider,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidityMinted
    );
    event Withdraw(
        address indexed provider,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    );
    event FeesDistributed(bytes32 indexed pairKey, uint256 feeA, uint256 feeB);
    event Swap(
        address indexed user,
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 outputAmount
    );
    event Forward(address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount);
    event FeeUpdate(uint16 newFee);
    event LPTokenCreated(bytes32 indexed pairKey, address lpToken);

    function deposit(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external;

    function withdraw(
        address tokenA,
        address tokenB,
        uint256 liquidityToWithdraw
    ) external;

    function swap(
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 minOutputAmount
    ) external;

    function getAmountOut(
        uint256 amountIn,
        address inputToken,
        address outputToken
    ) external view returns (uint256 amountOut);

    function getPairInfo(
        address tokenA,
        address tokenB
    )
        external
        view
        returns (
            address _token0,
            address _token1,
            uint112 _reserveA,
            uint112 _reserveB,
            uint256 _totalLiquidity
        );

    function getLPBalance(
        address user,
        address tokenA,
        address tokenB
    ) external view returns (uint256);

    function getKey(address tokenA, address tokenB) external pure returns (bytes32);

    function getReserves(
        address tokenA,
        address tokenB
    )
        external
        view
        returns (uint112 reserveA, uint112 reserveB);

    function setSwapFee(uint16 _newSwapFee) external;
}
