// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IUniswapV2Router02.sol";
import "./interfaces/ISwapeoDEX.sol";

contract SwapeoDEX is ReentrancyGuard, Ownable, ISwapeoDEX {
    using SafeERC20 for IERC20;

    struct PairInfo {
        uint112 reserveA;
        uint112 reserveB;
        uint32 timestamp;
        uint96 accumulatedFeeA;
        uint96  accumulatedFeeB;
        uint256 totalLiquidity;
    }

    error ZeroAddress();
    error IdenticalTokens();
    error InsufficientAmounts();
    error InvalidRatio();
    error NoLiquidity();
    error InsufficientLiquidity();
    error HighSlippage();
    error UseForward();
    error NoFees();
    error UnexistingPair();
    error InvalidFee();

    uint16 public swapFee;

    uint16 private constant FEE_DENOMINATOR = 1000;
    uint16 private constant FORWARD_FEE_DENOMINATOR = 1000;
    uint16 private constant FORWARD_FEE_NUMERATOR = 5;
    uint112 private constant MINIMUM_LIQUIDITY = 1;

    mapping(bytes32 => PairInfo) public s_pairKeyToPairInfo;
    mapping(bytes32 => mapping(address => uint256))
        public s_pairKeyToProviderToLiquidity;
    mapping(bytes32 => mapping(address => uint256))
        public s_pairKeyToProviderToFeeDebtA;
    mapping(bytes32 => mapping(address => uint256))
        public s_pairKeyToProviderToFeeDebtB;
    mapping(bytes32 => mapping(address => bool))
        private s_pairKeyToProviderToIsActive;
    mapping(bytes32 => address[]) public s_pairKeyToProviders;

    mapping(bytes32 => address[2]) private s_pairKeyToTokens;

    IUniswapV2Router02 public immutable router;

    constructor(
        address _routerAddress,
        uint16 _initialSwapFee
    ) Ownable(msg.sender) {
        if (_routerAddress == address(0)) revert ZeroAddress();
        if (_initialSwapFee > 50) revert InvalidFee();
        router = IUniswapV2Router02(_routerAddress);
        swapFee = _initialSwapFee;
    }

    function setSwapFee(uint16 _newSwapFee) external onlyOwner {
        if (_newSwapFee > 50) revert InvalidFee();
        swapFee = _newSwapFee;
        emit FeeUpdate(_newSwapFee);
    }

    function deposit(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external nonReentrant {
        if (tokenA == address(0) || tokenB == address(0)) revert ZeroAddress();
        if (tokenA == tokenB) revert IdenticalTokens();
        if (amountA == 0 || amountB == 0) revert InsufficientAmounts();

        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        PairInfo storage pair = s_pairKeyToPairInfo[pairKey];

        address[2] memory tokens = s_pairKeyToTokens[pairKey];
        if (tokens[0] == address(0)) {
            (tokens[0], tokens[1]) = tokenA < tokenB
                ? (tokenA, tokenB)
                : (tokenB, tokenA);
            s_pairKeyToTokens[pairKey] = tokens;
        }

        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        PairInfo memory pairCache = PairInfo({
            reserveA: pair.reserveA,
            reserveB: pair.reserveB,
            totalLiquidity: pair.totalLiquidity,
            timestamp: pair.timestamp,
            accumulatedFeeA: 0,
            accumulatedFeeB: 0
        });

        uint256 liquidityMinted;
        if (pairCache.timestamp == 0) {
            liquidityMinted = _sqrt(amountA * amountB) - MINIMUM_LIQUIDITY;
            pairCache.timestamp = uint32(block.timestamp);
        } else {
            uint256 liquidityFromA = (amountA * pairCache.totalLiquidity) /
                pairCache.reserveA;
            uint256 liquidityFromB = (amountB * pairCache.totalLiquidity) /
                pairCache.reserveB;
            liquidityMinted = liquidityFromA < liquidityFromB
                ? liquidityFromA
                : liquidityFromB;
        }

        uint256 prevBal = s_pairKeyToProviderToLiquidity[pairKey][msg.sender];
        if (prevBal > 0) _distribute(pairKey, msg.sender);

        s_pairKeyToProviderToLiquidity[pairKey][msg.sender] =
            prevBal +
            liquidityMinted;
        if (!s_pairKeyToProviderToIsActive[pairKey][msg.sender]) {
            s_pairKeyToProviderToIsActive[pairKey][msg.sender] = true;
            s_pairKeyToProviders[pairKey].push(msg.sender);
        }

        pairCache.reserveA += uint112(amountA);
        pairCache.reserveB += uint112(amountB);
        pairCache.totalLiquidity += liquidityMinted;

        pair.reserveA = pairCache.reserveA;
        pair.reserveB = pairCache.reserveB;
        pair.totalLiquidity = pairCache.totalLiquidity;
        pair.timestamp = pairCache.timestamp;

        emit Deposit(
            msg.sender,
            tokenA,
            tokenB,
            amountA,
            amountB,
            liquidityMinted
        );
    }

    function withdraw(
        address tokenA,
        address tokenB,
        uint256 liquidityToWithdraw
    ) external nonReentrant {
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        PairInfo storage pair = s_pairKeyToPairInfo[pairKey];

        PairInfo memory pairCache = PairInfo({
            reserveA: pair.reserveA,
            reserveB: pair.reserveB,
            totalLiquidity: pair.totalLiquidity,
            timestamp: pair.timestamp,
            accumulatedFeeA: 0,
            accumulatedFeeB: 0
        });

        uint256 userLiquidity = s_pairKeyToProviderToLiquidity[pairKey][
            msg.sender
        ];
        if (liquidityToWithdraw == 0 || liquidityToWithdraw > userLiquidity)
            revert InsufficientLiquidity();

        uint256 withdrawnAmountA;
        uint256 withdrawnAmountB;

        address[2] memory tokens = s_pairKeyToTokens[pairKey];

        if (liquidityToWithdraw == pairCache.totalLiquidity) {
            withdrawnAmountA = IERC20(tokens[0]).balanceOf(address(this));
            withdrawnAmountB = IERC20(tokens[1]).balanceOf(address(this));
        } else {
            withdrawnAmountA =
                (liquidityToWithdraw * pairCache.reserveA) /
                pairCache.totalLiquidity;
            withdrawnAmountB =
                (liquidityToWithdraw * pairCache.reserveB) /
                pairCache.totalLiquidity;
        }

        _distribute(pairKey, msg.sender);
        s_pairKeyToProviderToLiquidity[pairKey][msg.sender] =
            userLiquidity -
            liquidityToWithdraw;

        if (liquidityToWithdraw == pairCache.totalLiquidity) {
            pair.reserveA = 0;
            pair.reserveB = 0;
            pair.totalLiquidity = 0;
        } else {
            pairCache.reserveA = uint112(pairCache.reserveA - withdrawnAmountA);
            pairCache.reserveB = uint112(pairCache.reserveB - withdrawnAmountB);
            pairCache.totalLiquidity =
                pairCache.totalLiquidity -
                liquidityToWithdraw;
            pair.reserveA = pairCache.reserveA;
            pair.reserveB = pairCache.reserveB;
            pair.totalLiquidity = pairCache.totalLiquidity;
        }

        IERC20(tokens[0]).safeTransfer(msg.sender, withdrawnAmountA);
        IERC20(tokens[1]).safeTransfer(msg.sender, withdrawnAmountB);

        emit Withdraw(
            msg.sender,
            tokenA,
            tokenB,
            withdrawnAmountA,
            withdrawnAmountB
        );
    }

    function swap(
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 minOutputAmount
    ) external nonReentrant returns (uint256) {
        if (inputToken == address(0) || outputToken == address(0))
            revert ZeroAddress();
        if (inputToken == outputToken || inputAmount == 0)
            revert InsufficientAmounts();

        bytes32 pairKey = _generatePairKey(inputToken, outputToken);
        PairInfo storage pair = s_pairKeyToPairInfo[pairKey];

        if (pair.reserveA == 0 || pair.reserveB == 0) {
            return
                _forwardToUniswap(
                    inputToken,
                    outputToken,
                    inputAmount,
                    minOutputAmount
                );
        }
        IERC20(inputToken).safeTransferFrom(
            msg.sender,
            address(this),
            inputAmount
        );

        PairInfo memory pairCache = PairInfo({
            reserveA: pair.reserveA,
            reserveB: pair.reserveB,
            totalLiquidity: 0,
            timestamp: 0,
            accumulatedFeeA: 0,
            accumulatedFeeB: 0
        });

        uint256 feeAmt = (inputAmount * swapFee) / FEE_DENOMINATOR;
        uint256 netInputAmount = inputAmount - feeAmt;

        address token0 = s_pairKeyToTokens[pairKey][0];
        uint256 reserveIn = inputToken == token0
            ? pairCache.reserveA
            : pairCache.reserveB;
        uint256 reserveOut = inputToken == token0
            ? pairCache.reserveB
            : pairCache.reserveA;

        uint256 outputAmount = reserveOut -
            ((reserveIn * reserveOut) / (reserveIn + netInputAmount));

        if (outputAmount < minOutputAmount) revert HighSlippage();

        if (inputToken == token0) {
            pairCache.reserveA = uint112(pairCache.reserveA + netInputAmount);
            pairCache.reserveB = uint112(pairCache.reserveB - outputAmount);
            pair.accumulatedFeeA += feeAmt;
        } else {
            pairCache.reserveB = uint112(pairCache.reserveB + netInputAmount);
            pairCache.reserveA = uint112(pairCache.reserveA - outputAmount);
            pair.accumulatedFeeB += feeAmt;
        }

        pair.reserveA = pairCache.reserveA;
        pair.reserveB = pairCache.reserveB;
        pair.timestamp = uint32(block.timestamp);

        IERC20(outputToken).safeTransfer(msg.sender, outputAmount);
        emit Swap(
            msg.sender,
            inputToken,
            outputToken,
            inputAmount,
            outputAmount
        );
        return outputAmount;
    }

    function claimFees(address tA, address tB) external nonReentrant {
        bytes32 pairKey = _generatePairKey(tA, tB);
        _distribute(pairKey, msg.sender);
    }

    function distributeFees(
        address tokenA,
        address tokenB
    ) external nonReentrant onlyOwner {
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        PairInfo storage pair = s_pairKeyToPairInfo[pairKey];

        PairInfo memory pairCache = PairInfo({
            reserveA: pair.reserveA,
            reserveB: pair.reserveB,
            totalLiquidity: 0,
            timestamp: 0,
            accumulatedFeeA: 0,
            accumulatedFeeB: 0
        });
        uint256 feesA = pair.accumulatedFeeA;
        uint256 feesB = pair.accumulatedFeeB;

        if (pairCache.reserveA == 0 && pairCache.reserveB == 0)
            revert UnexistingPair();
        if (feesA == 0 && feesB == 0) revert NoFees();

        pairCache.reserveA += uint112(feesA);
        pairCache.reserveB += uint112(feesB);

        pair.reserveA = pairCache.reserveA;
        pair.reserveB = pairCache.reserveB;
        pair.accumulatedFeeA = 0;
        pair.accumulatedFeeB = 0;

        emit FeesDistributed(pairKey, feesA, feesB);
    }

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
        )
    {
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        PairInfo storage pair = s_pairKeyToPairInfo[pairKey];
        address[2] memory tkns = s_pairKeyToTokens[pairKey];

        _token0 = tkns[0];
        _token1 = tkns[1];
        _reserveA = pair.reserveA;
        _reserveB = pair.reserveB;
        _totalLiquidity = pair.totalLiquidity;
        _accumulatedFeeA = pair.accumulatedFeeA;
        _accumulatedFeeB = pair.accumulatedFeeB;
    }

    function getLPBalance(
        address user,
        address tokenA,
        address tokenB
    ) external view returns (uint256) {
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        return s_pairKeyToProviderToLiquidity[pairKey][user];
    }

    function getLPProviders(
        address tokenA,
        address tokenB
    ) external view returns (address[] memory) {
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        return s_pairKeyToProviders[pairKey];
    }

    function getReserves(
        address tokenA,
        address tokenB
    )
        external
        view
        returns (uint112 reserveA, uint112 reserveB, uint32 timestamp)
    {
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        PairInfo storage pair = s_pairKeyToPairInfo[pairKey];
        reserveA = pair.reserveA;
        reserveB = pair.reserveB;
        timestamp = pair.timestamp;
    }

    function feesCollected(
        bytes32 pairKey
    ) external view returns (uint256 feeA, uint256 feeB) {
        PairInfo storage pair = s_pairKeyToPairInfo[pairKey];
        feeA = pair.accumulatedFeeA;
        feeB = pair.accumulatedFeeB;
    }

    function getKey(
        address tokenA,
        address tokenB
    ) public pure returns (bytes32) {
        return _generatePairKey(tokenA, tokenB);
    }

    function getAmountOut(
        uint256 amountIn,
        address inputToken,
        address outputToken
    ) public view returns (uint256 amountOut) {
        if (inputToken == address(0) || outputToken == address(0))
            revert ZeroAddress();
        if (inputToken == outputToken) revert IdenticalTokens();
        if (amountIn == 0) revert InsufficientAmounts();

        bytes32 pairKey = _generatePairKey(inputToken, outputToken);
        PairInfo storage pair = s_pairKeyToPairInfo[pairKey];
        if (pair.reserveA == 0 || pair.reserveB == 0) revert NoLiquidity();

        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - swapFee);

        address token0 = s_pairKeyToTokens[pairKey][0];

        uint256 reserveIn = (inputToken == token0)
            ? pair.reserveA
            : pair.reserveB;
        uint256 reserveOut = (inputToken == token0)
            ? pair.reserveB
            : pair.reserveA;

        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;

        return numerator / denominator;
    }

        function _forwardToUniswap(
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 minOutputAmount
    ) internal returns (uint256) {
        IERC20(inputToken).safeTransferFrom(
            msg.sender,
            address(this),
            inputAmount
        );

        uint256 fee = (inputAmount * FORWARD_FEE_NUMERATOR) /
            FORWARD_FEE_DENOMINATOR;
        uint256 netInputAmount = inputAmount - fee;
        IERC20(inputToken).safeTransfer(owner(), fee);
        IERC20 token = IERC20(inputToken);
        token.approve(address(router), netInputAmount);

        address[] memory path = new address[](2);
        path[0] = inputToken;
        path[1] = outputToken;
        uint256[] memory results = router.swapExactTokensForTokens(
            netInputAmount,
            minOutputAmount,
            path,
            msg.sender,
            block.timestamp
        );

        IERC20(inputToken).approve(address(router), 0);

        uint256 outputAmount = results[1];
        emit Forward(inputToken, outputToken, inputAmount, outputAmount);
        return outputAmount;
    }

    function _generatePairKey(
        address tokenA,
        address tokenB
    ) private pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    tokenA < tokenB ? tokenA : tokenB,
                    tokenA < tokenB ? tokenB : tokenA
                )
            );
    }

    function _distribute(bytes32 pairKey, address user) private {
        PairInfo storage pair = s_pairKeyToPairInfo[pairKey];
        uint256 totalA = pair.accumulatedFeeA;
        uint256 totalB = pair.accumulatedFeeB;
        uint256 userBal = s_pairKeyToProviderToLiquidity[pairKey][user];

        if (userBal > 0 && pair.totalLiquidity > 0) {
            uint256 shareA = (totalA * userBal) / pair.totalLiquidity;
            uint256 shareB = (totalB * userBal) / pair.totalLiquidity;
            uint256 owedA = shareA >
                s_pairKeyToProviderToFeeDebtA[pairKey][user]
                ? shareA - s_pairKeyToProviderToFeeDebtA[pairKey][user]
                : 0;
            uint256 owedB = shareB >
                s_pairKeyToProviderToFeeDebtB[pairKey][user]
                ? shareB - s_pairKeyToProviderToFeeDebtB[pairKey][user]
                : 0;

            address[2] memory tkns = s_pairKeyToTokens[pairKey];

            if (owedA > 0) {
                s_pairKeyToProviderToFeeDebtA[pairKey][user] += owedA;
                IERC20(tkns[0]).safeTransfer(user, owedA);
            }
            if (owedB > 0) {
                s_pairKeyToProviderToFeeDebtB[pairKey][user] += owedB;
                IERC20(tkns[1]).safeTransfer(user, owedB);
            }
        }
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        z = y;
        if (z > 3) {
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
