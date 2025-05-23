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
    ) external returns (uint256);

    function claimFees(address tA, address tB) external;

    function distributeFees(address tokenA, address tokenB) external;

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
            uint256 _totalLiquidity,
            uint256 _accumulatedFeeA,
            uint256 _accumulatedFeeB
        );

    function getLPBalance(
        address user,
        address tokenA,
        address tokenB
    ) external view returns (uint256);

    function getLPProviders(
        address tokenA,
        address tokenB
    ) external view returns (address[] memory);

    function getKey(address tokenA, address tokenB) external pure returns (bytes32);

    function getReserves(
        address tokenA,
        address tokenB
    )
        external
        view
        returns (uint112 reserveA, uint112 reserveB, uint32 timestamp);

    function feesCollected(bytes32 pairKey) external view returns (uint256 feeA, uint256 feeB);

    function pause() external;

    function unpause() external;

    function setSwapFee(uint16 _newSwapFee) external;
}
