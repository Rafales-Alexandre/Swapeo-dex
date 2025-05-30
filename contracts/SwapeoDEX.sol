// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./interfaces/IUniswapV2Router02.sol";
import "./interfaces/ISwapeoDEX.sol";
import "./SwapeoLP.sol";
import "./libraries/SwapeoErrors.sol";


/**
 * @title SwapeoDEX
 * @notice AMM-based DEX inspired by Uniswap V2, with fallback to Uniswap for unsupported pairs.
 * @dev
 * - MINIMUM_LIQUIDITY is locked to a burn address (Uniswap V2 logic, OpenZeppelin compatible).
 * - Fees for fallback swaps go to the owner; for production, consider DAO or LP fee distribution.
 * - Full withdrawals also claim any ERC20 "dust" in the contract, as in Uniswap.
 * - LP token deployment uses CREATE2 for deterministic addresses.
 * - Only standard-compliant ERC20 tokens are supported; fee-on-transfer or non-standard tokens may cause unexpected behavior.
 */
contract SwapeoDEX is ReentrancyGuard, Ownable, ISwapeoDEX {
    using SafeERC20 for IERC20;

    struct PairInfo {
        uint112 reserveA;
        uint112 reserveB;
        uint32 timestamp; // timestamp is reserved for future use (e.g., TWAP/oracle)
        uint256 totalLiquidity;
    }
    uint16 public swapFee;

    uint16 private constant FEE_DENOMINATOR = 1000;
    uint16 private constant FORWARD_FEE_DENOMINATOR = 1000;
    uint16 private constant FORWARD_FEE_NUMERATOR = 5;
    // Minimum liquidity locked forever to prevent the pool from being fully drained by a single user.
    uint112 private constant MINIMUM_LIQUIDITY = 1;
    // Irrecoverable "burn" address for locking MINIMUM_LIQUIDITY, since OpenZeppelin ERC20 forbids minting to address(0)
    address constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

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
    ) external nonReentrant {
        if (tokenA == address(0) || tokenB == address(0)) revert ZeroAddress();
        if (tokenA == tokenB) revert IdenticalTokens();
        if (amountA == 0 || amountB == 0) revert InsufficientAmounts();

        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        PairInfo storage pair = pairKeyToPairInfo[pairKey];

        (address token0, address token1) = _sortTokens(tokenA, tokenB);

        if (pairKeyToLPToken[pairKey] == address(0)) {
            (
                string memory tokenSymbol0,
                string memory tokenSymbol1
            ) = getTokenSymbols(token0, token1);

            string memory tokenSymbol = string(
                abi.encodePacked("SWP-LP-", tokenSymbol0, "-", tokenSymbol1)
            );
            string memory tokenName = string(
                abi.encodePacked(
                    "Swapeo LP Token for ",
                    tokenSymbol0,
                    "-",
                    tokenSymbol1
                )
            );

            // Deploy LP token with CREATE2 to ensure deterministic address per pair.     
            // This guarantees one unique LP token per pair, and makes pool discovery easier for external tools.
            address lpTokenAddr = deployLPToken(
                tokenName,
                tokenSymbol,
                pairKey
            );

            pairKeyToLPToken[pairKey] = lpTokenAddr;
            pairKeyToTokens[pairKey] = [token0, token1];

            emit LPTokenCreated(pairKey, lpTokenAddr);
        }

        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        PairInfo memory cachedPairInfo = PairInfo({
            reserveA: pair.reserveA,
            reserveB: pair.reserveB,
            timestamp: pair.timestamp,
            totalLiquidity: pair.totalLiquidity
        });

        uint256 liquidityMinted;

        if (cachedPairInfo.timestamp == 0) {
            liquidityMinted = _sqrt(amountA * amountB);
            if (liquidityMinted <= MINIMUM_LIQUIDITY) revert InsufficientInitialLiquidity();
            // Permanently lock MINIMUM_LIQUIDITY to address(0) to prevent anyone from ever draining the entire pool (Uniswap V2 convention).
            SwapeoLP(pairKeyToLPToken[pairKey]).mint(DEAD_ADDRESS, MINIMUM_LIQUIDITY);
            liquidityMinted -= MINIMUM_LIQUIDITY;
            cachedPairInfo.timestamp = uint32(block.timestamp);
        } else {
            uint256 liquidityFromA = (amountA * cachedPairInfo.totalLiquidity) /
                cachedPairInfo.reserveA;
            uint256 liquidityFromB = (amountB * cachedPairInfo.totalLiquidity) /
                cachedPairInfo.reserveB;
            liquidityMinted = liquidityFromA < liquidityFromB
                ? liquidityFromA
                : liquidityFromB;
        }
        SwapeoLP(pairKeyToLPToken[pairKey]).mint(msg.sender, liquidityMinted);

        cachedPairInfo.reserveA += uint112(amountA);
        cachedPairInfo.reserveB += uint112(amountB);
        cachedPairInfo.totalLiquidity += liquidityMinted;

        pair.reserveA = cachedPairInfo.reserveA;
        pair.reserveB = cachedPairInfo.reserveB;
        pair.totalLiquidity = cachedPairInfo.totalLiquidity;
        pair.timestamp = cachedPairInfo.timestamp;

        emit Deposit(
            msg.sender,
            tokenA,
            tokenB,
            amountA,
            amountB,
            liquidityMinted
        );
    }

    // If the user withdraws all liquidity, they also receive any extra token "dust" or airdropped tokens.
    // This mirrors Uniswap V2 behavior.
    function withdraw(
        address tokenA,
        address tokenB,
        uint256 liquidityToWithdraw
    ) external nonReentrant {
        if (tokenA == tokenB) revert IdenticalTokens();
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        PairInfo storage pair = pairKeyToPairInfo[pairKey];

        address lpTokenAddress = pairKeyToLPToken[pairKey];
        if (lpTokenAddress == address(0)) revert UnexistingPair();

        uint256 userLiquidity = SwapeoLP(lpTokenAddress).balanceOf(msg.sender);
        if (liquidityToWithdraw == 0 || liquidityToWithdraw > userLiquidity)
            revert InsufficientLiquidity();

        PairInfo memory cachedPairInfo = PairInfo({
            reserveA: pair.reserveA,
            reserveB: pair.reserveB,
            timestamp: pair.timestamp,
            totalLiquidity: pair.totalLiquidity
        });

        uint256 withdrawnAmountA;
        uint256 withdrawnAmountB;

        address[2] memory tokens = pairKeyToTokens[pairKey];

        if (liquidityToWithdraw == cachedPairInfo.totalLiquidity) {
            // If user withdraws all liquidity, send all contract balances.
            withdrawnAmountA = IERC20(tokens[0]).balanceOf(address(this));
            withdrawnAmountB = IERC20(tokens[1]).balanceOf(address(this));
            cachedPairInfo.reserveA = 0;
            cachedPairInfo.reserveB = 0;
            cachedPairInfo.totalLiquidity = 0;
        } else {
            withdrawnAmountA =
                (liquidityToWithdraw * cachedPairInfo.reserveA) /
                cachedPairInfo.totalLiquidity;
            withdrawnAmountB =
                (liquidityToWithdraw * cachedPairInfo.reserveB) /
                cachedPairInfo.totalLiquidity;

            cachedPairInfo.reserveA -= uint112(withdrawnAmountA);
            cachedPairInfo.reserveB -= uint112(withdrawnAmountB);
            cachedPairInfo.totalLiquidity -= liquidityToWithdraw;
        }
        SwapeoLP(lpTokenAddress).burn(msg.sender, liquidityToWithdraw);

        pair.reserveA = cachedPairInfo.reserveA;
        pair.reserveB = cachedPairInfo.reserveB;
        pair.totalLiquidity = cachedPairInfo.totalLiquidity;

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
        if (inputToken == outputToken) revert IdenticalTokens();   
        if (inputToken == address(0) || outputToken == address(0))
            revert ZeroAddress();
        if (inputAmount == 0)
            revert InsufficientAmounts();

        bytes32 pairKey = _generatePairKey(inputToken, outputToken);
        PairInfo storage pair = pairKeyToPairInfo[pairKey];

        (address token0, address token1) = _sortTokens(inputToken, outputToken);

        uint112 reserveA = pair.reserveA;
        uint112 reserveB = pair.reserveB;

        if (reserveA == 0 || reserveB == 0) {
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

        uint112 balanceA = uint112(IERC20(token0).balanceOf(address(this)));
        uint112 balanceB = uint112(IERC20(token1).balanceOf(address(this)));

        uint256 amountIn = (inputToken == token0 ? balanceA : balanceB) -
            (inputToken == token0 ? reserveA : reserveB);
        
        if (amountIn == 0) revert InsufficientAmounts();

        // Standard x*y=k AMM formula with fee applied on input amount.
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - swapFee);

        uint256 reserveIn = inputToken == token0 ? reserveA : reserveB;
        uint256 reserveOut = inputToken == token0 ? reserveB : reserveA;

        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;

        if (denominator == 0) revert NoLiquidity();
        uint256 amountOut = numerator / denominator;

        if (amountOut == 0 || amountOut > reserveOut) revert HighSlippage();
        if (amountOut < minOutputAmount) revert HighSlippage();

        IERC20(outputToken).safeTransfer(msg.sender, amountOut);

        if (inputToken == token0) {
            uint256 newReserveB = balanceB - amountOut;
            if (amountOut > balanceB) revert AmountOutExceedsReserveB();
            // Ensure reserves never overflow uint112 and amounts are not greater than available balances.
            if (newReserveB > type(uint112).max) revert ReserveBOverflow();
            if (balanceA > type(uint112).max) revert ReserveAOverflow();
            pair.reserveA = uint112(balanceA);
            pair.reserveB = uint112(newReserveB);
        } else {
            uint256 newReserveA = balanceA - amountOut;
            if (amountOut > balanceA) revert AmountOutExceedsReserveA();
            if (newReserveA > type(uint112).max) revert ReserveAOverflow();
            if (balanceB > type(uint112).max) revert ReserveBOverflow();
            pair.reserveA = uint112(newReserveA);
            pair.reserveB = uint112(balanceB);
        }
        pair.timestamp = uint32(block.timestamp);

        emit Swap(msg.sender, inputToken, outputToken, inputAmount, amountOut);
        return amountOut;
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
        address[2] memory tokens = pairKeyToTokens[pairKey];

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
    ) external view returns (uint256) {
        if (tokenA == tokenB) return 0;
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
        returns (uint112 reserveA, uint112 reserveB, uint32 timestamp)
    {
        bytes32 pairKey = _generatePairKey(tokenA, tokenB);
        PairInfo storage pair = pairKeyToPairInfo[pairKey];
        reserveA = pair.reserveA;
        reserveB = pair.reserveB;
        timestamp = pair.timestamp;
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

    // NOTE: Forwarding fee goes to the contract owner (centralized for now). For production, switch to DAO or fee-split.
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
        // Protocol fee for Uniswap fallback swaps is sent to the contract owner.
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

    function deployLPToken(
        string memory name,
        string memory symbol,
        bytes32 salt
    ) internal returns (address lpTokenAddr) {
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

    function getTokenSymbols(
        address token0,
        address token1
    ) internal view returns (string memory, string memory) {
        string memory symbol0 = IERC20Metadata(token0).symbol();
        string memory symbol1 = IERC20Metadata(token1).symbol();
        return (symbol0, symbol1);
    }

    function _generatePairKey(
        address tokenA,
        address tokenB
    ) private pure returns (bytes32) {
        if (tokenA == tokenB) revert IdenticalTokens();
        if (tokenA == address(0) || tokenB == address(0)) revert ZeroAddress();
        (address token0, address token1) = _sortTokens(tokenA, tokenB);
        return keccak256(abi.encodePacked(token0, token1));
    }

    // Sort tokens by address to ensure consistent ordering for pair key generation and storage.
    function _sortTokens(
        address tokenA,
        address tokenB
    ) private pure returns (address token0, address token1) {
        if (tokenA == tokenB) revert IdenticalTokens();
        (token0, token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
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
