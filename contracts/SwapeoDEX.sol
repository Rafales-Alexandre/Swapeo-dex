// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./interfaces/IUniswapV2Router02.sol";
import "./interfaces/ISwapeoDEX.sol";
import "./SwapeoLP.sol";
import "./libraries/SwapeoErrors.sol";
import { SwapeoModifiers } from "./libraries/SwapeoModifiers.sol";

contract SwapeoDEX is Ownable, ISwapeoDEX, SwapeoModifiers {
    using SafeERC20 for IERC20;

    struct PairInfo {
        uint112 reserveA;
        uint112 reserveB;
        uint256 totalLiquidity;
    }
    uint16 public swapFee;

    uint16 private constant FEE_DENOMINATOR = 1000;
    uint112 private constant MINIMUM_LIQUIDITY = 1;
    address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    mapping(bytes32 => address) public pairKeyToLPToken;
    mapping(bytes32 => PairInfo) public pairKeyToPairInfo;
    mapping(bytes32 => address[2]) private pairKeyToTokens;

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
    ) external validTokenPair(tokenA, tokenB) nonZeroAmount(amountA) nonZeroAmount(amountB) {
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        PairInfo storage pair = pairKeyToPairInfo[pairKey];

        (address token0, address token1) = _sortTokens(tokenA, tokenB);
        bool isTokenAFirst = tokenA == token0;

        if (pairKeyToLPToken[pairKey] == address(0)) {
            (string memory tokenSymbol0, string memory tokenSymbol1) = _getTokenSymbols(token0, token1);

            string memory tokenSymbol = string(abi.encodePacked("SWP-LP-", tokenSymbol0, "-", tokenSymbol1));
            string memory tokenName = string(abi.encodePacked("Swapeo LP Token for ", tokenSymbol0, "-", tokenSymbol1));

            address lpTokenAddr = _deployLPToken(tokenName, tokenSymbol, pairKey);

            pairKeyToLPToken[pairKey] = lpTokenAddr;
            pairKeyToTokens[pairKey] = [token0, token1];

            emit LPTokenCreated(pairKey, lpTokenAddr);
        }

        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        uint256 liquidityMinted;
        uint256 _totalLiquidity = pair.totalLiquidity;

        if (_totalLiquidity == 0) {
            liquidityMinted = _sqrt(amountA * amountB);
            if (liquidityMinted <= MINIMUM_LIQUIDITY) revert InsufficientInitialLiquidity();
            SwapeoLP(pairKeyToLPToken[pairKey]).mint(DEAD_ADDRESS, MINIMUM_LIQUIDITY);
            liquidityMinted -= MINIMUM_LIQUIDITY;
        } else {
            uint256 amountForToken0 = isTokenAFirst ? amountA : amountB;
            uint256 amountForToken1 = isTokenAFirst ? amountB : amountA;
            
            uint256 liquidityFromA = (amountForToken0 * _totalLiquidity) / pair.reserveA;
            uint256 liquidityFromB = (amountForToken1 * _totalLiquidity) / pair.reserveB;
            liquidityMinted = liquidityFromA < liquidityFromB ? liquidityFromA : liquidityFromB;
        }
        SwapeoLP(pairKeyToLPToken[pairKey]).mint(msg.sender, liquidityMinted);

        if (isTokenAFirst) {
            pair.reserveA += uint112(amountA);
            pair.reserveB += uint112(amountB);
        } else {
            pair.reserveA += uint112(amountB);
            pair.reserveB += uint112(amountA);
        }
        pair.totalLiquidity = _totalLiquidity + liquidityMinted;

        emit Deposit(msg.sender, tokenA, tokenB, amountA, amountB, liquidityMinted);
    }

    function withdraw(
        address tokenA,
        address tokenB,
        uint256 liquidityToWithdraw
    ) external notIdenticalTokens(tokenA, tokenB) validTokenPair(tokenA, tokenB) {
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        PairInfo storage pair = pairKeyToPairInfo[pairKey];

        address lpTokenAddress = pairKeyToLPToken[pairKey];
        if (lpTokenAddress == address(0)) revert UnexistingPair();

        uint256 userLiquidity = SwapeoLP(lpTokenAddress).balanceOf(msg.sender);
        if (liquidityToWithdraw == 0 || liquidityToWithdraw > userLiquidity)
            revert InsufficientLiquidity();

        uint112 _reserveA = pair.reserveA;
        uint112 _reserveB = pair.reserveB;
        uint256 _totalLiquidity = pair.totalLiquidity;

        uint256 withdrawnAmountA;
        uint256 withdrawnAmountB;

        address[2] memory tokens = pairKeyToTokens[pairKey];

        if (liquidityToWithdraw == _totalLiquidity) {
            withdrawnAmountA = _reserveA;
            withdrawnAmountB = _reserveB;
            pair.reserveA = 0;
            pair.reserveB = 0;
            pair.totalLiquidity = 0;
        } else {
            withdrawnAmountA = (liquidityToWithdraw * _reserveA) / _totalLiquidity;
            withdrawnAmountB = (liquidityToWithdraw * _reserveB) / _totalLiquidity;

            pair.reserveA = uint112(_reserveA - withdrawnAmountA);
            pair.reserveB = uint112(_reserveB - withdrawnAmountB);
            pair.totalLiquidity = _totalLiquidity - liquidityToWithdraw;
        }
        
        SwapeoLP(lpTokenAddress).burn(msg.sender, liquidityToWithdraw);

        IERC20(tokens[0]).safeTransfer(msg.sender, withdrawnAmountA);
        IERC20(tokens[1]).safeTransfer(msg.sender, withdrawnAmountB);

        emit Withdraw(msg.sender, tokenA, tokenB, withdrawnAmountA, withdrawnAmountB);
    }

    function swap(
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 minOutputAmount
    ) external validSwapTokens(inputToken, outputToken) nonZeroAmount(inputAmount) {
        bytes32 pairKey = _generatePairKey(inputToken, outputToken);
        PairInfo storage pair = pairKeyToPairInfo[pairKey];

        uint112 _reserveA = pair.reserveA;
        uint112 _reserveB = pair.reserveB;

        if (_reserveA == 0 || _reserveB == 0) {
            _forwardToUniswap(inputToken, outputToken, inputAmount, minOutputAmount);
            return;
        }

        (address token0, address token1) = _sortTokens(inputToken, outputToken);
        bool isToken0Input = inputToken == token0;

        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), inputAmount);

        uint112 balanceA = uint112(IERC20(token0).balanceOf(address(this)));
        uint112 balanceB = uint112(IERC20(token1).balanceOf(address(this)));

        uint256 amountIn = (isToken0Input ? balanceA : balanceB) - (isToken0Input ? _reserveA : _reserveB);

        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - swapFee);

        uint256 reserveIn = isToken0Input ? _reserveA : _reserveB;
        uint256 reserveOut = isToken0Input ? _reserveB : _reserveA;

        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;

        if (denominator == 0) revert NoLiquidity();
        uint256 amountOut = numerator / denominator;

        if (amountOut == 0 || amountOut > reserveOut) revert HighSlippage();
        if (amountOut < minOutputAmount) revert HighSlippage();

        IERC20(outputToken).safeTransfer(msg.sender, amountOut);

        if (isToken0Input) {
            pair.reserveA = balanceA;
            pair.reserveB = uint112(balanceB - amountOut);
        } else {
            pair.reserveA = uint112(balanceA - amountOut);
            pair.reserveB = balanceB;
        }

        emit Swap(msg.sender, inputToken, outputToken, inputAmount, amountOut);
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
            uint256 _totalLiquidity
        )
    {
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        PairInfo storage pair = pairKeyToPairInfo[pairKey];
        address[2] storage tokens = pairKeyToTokens[pairKey];

        _token0 = tokens[0];
        _token1 = tokens[1];
        _reserveA = pair.reserveA;
        _reserveB = pair.reserveB;
        _totalLiquidity = pair.totalLiquidity;
    }

    function getLPBalance(
        address user,
        address tokenA,
        address tokenB
    ) external view notIdenticalTokens(tokenA, tokenB) returns (uint256) {
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        address lpTokenAddress = pairKeyToLPToken[pairKey];
        if (lpTokenAddress == address(0)) return 0;
        return IERC20(lpTokenAddress).balanceOf(user);
    }

    function getReserves(
        address tokenA,
        address tokenB
    )
        external
        view
        returns (uint112 reserveA, uint112 reserveB)
    {
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        PairInfo storage pair = pairKeyToPairInfo[pairKey];
        reserveA = pair.reserveA;
        reserveB = pair.reserveB;
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
    ) public view validSwapTokens(inputToken, outputToken) nonZeroAmount(amountIn) returns (uint256 amountOut) {
        bytes32 pairKey = _generatePairKey(inputToken, outputToken);
        PairInfo storage pair = pairKeyToPairInfo[pairKey];
        if (pair.reserveA == 0 || pair.reserveB == 0) revert NoLiquidity();

        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - swapFee);

        address token0 = pairKeyToTokens[pairKey][0];

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
    ) private {
        IERC20(inputToken).safeTransferFrom(
            msg.sender,
            address(this),
            inputAmount
        );

        uint256 fee = (inputAmount * swapFee) / FEE_DENOMINATOR;
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
    }

    function _deployLPToken(
        string memory name,
        string memory symbol,
        bytes32 salt
    ) private returns (address lpTokenAddr) {
        bytes memory bytecode = abi.encodePacked(
            type(SwapeoLP).creationCode,
            abi.encode(name, symbol)
        );
        assembly {
            lpTokenAddr := create2(0, add(bytecode, 32), mload(bytecode), salt)
            if iszero(lpTokenAddr) {
                revert(0, 0)
            }
        }
    }

    function _getTokenSymbols(
        address token0,
        address token1
    ) private view returns (string memory, string memory) {
        string memory symbol0 = IERC20Metadata(token0).symbol();
        string memory symbol1 = IERC20Metadata(token1).symbol();
        return (symbol0, symbol1);
    }

    function _generatePairKey(
        address tokenA,
        address tokenB
    ) private pure returns (bytes32) {
        (address token0, address token1) = _sortTokens(tokenA, tokenB);
        return keccak256(abi.encodePacked(token0, token1));
    }

    function _sortTokens(
        address tokenA,
        address tokenB
    ) private pure returns (address token0, address token1) {
        (token0, token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
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