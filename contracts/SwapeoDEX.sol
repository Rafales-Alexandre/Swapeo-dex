// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SafeERC20, IERC20 as _IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
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

contract SwapeoDEX is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for _IERC20;
    uint16 public swapFee;
    uint16 private constant FEE_DEN = 1000;
    uint16 private constant ADD_DEN = 1000;
    uint16 private constant ADD_NUM = 5;
    uint112 private constant MIN_LIQ = 1;

    struct Pair {
        uint112 rA;
        uint112 rB;
        uint32 t;
        uint256 totLiq;
        uint256 accFeeA;
        uint256 accFeeB;
    }
    mapping(bytes32 => Pair) public pairs;
    mapping(bytes32 => mapping(address => uint256)) public bal;
    mapping(bytes32 => mapping(address => uint256)) public debtA;
    mapping(bytes32 => mapping(address => uint256)) public debtB;
    mapping(bytes32 => mapping(address => bool)) private provider;
    mapping(bytes32 => address[]) public providers;

    mapping(bytes32 => address[2]) private pairTokens;

    IUniswapV2Router02 public immutable router;

    event Deposit(
        address indexed p,
        address t0,
        address t1,
        uint256 a0,
        uint256 a1,
        uint256 liq
    );
    event Withdraw(
        address indexed p,
        address t0,
        address t1,
        uint256 a0,
        uint256 a1
    );
    event FeesDistributed(bytes32 indexed pairKey, uint256 feeA, uint256 feeB);
    event Swap(
        address indexed u,
        address inT,
        address outT,
        uint256 amtIn,
        uint256 amtOut
    );
    event Forward(address inT, address outT, uint256 amtIn, uint256 amtOut);
    event FeeUpdate(uint16 newFee);

    struct Locals {
        uint112 rA;
        uint112 rB;
        uint256 totLiq;
        uint32 lastTs;
    }

    constructor(address _r, uint16 _f) Ownable(msg.sender) {
        if (_r == address(0)) revert ZeroAddress();
        if (_f > 50) revert InvalidFee();
        router = IUniswapV2Router02(_r);
        swapFee = _f;
    }

    function setSwapFee(uint16 f) external onlyOwner {
        if (f > 50) revert InvalidFee();
        swapFee = f;
        emit FeeUpdate(f);
    }

    function _key(address a, address b) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(a < b ? a : b, a < b ? b : a));
    }

    function deposit(
        address tA,
        address tB,
        uint256 aA,
        uint256 aB
    ) external whenNotPaused nonReentrant {
        if (tA == address(0) || tB == address(0)) revert ZeroAddress();
        if (tA == tB) revert IdenticalTokens();
        if (aA == 0 || aB == 0) revert InsufficientAmounts();

        bytes32 k = _key(tA, tB);
        Pair storage p = pairs[k];

        address[2] memory tkns = pairTokens[k];
        if (tkns[0] == address(0)) {
            (tkns[0], tkns[1]) = tA < tB ? (tA, tB) : (tB, tA);
            pairTokens[k] = tkns;
        }

        _IERC20(tA).safeTransferFrom(msg.sender, address(this), aA);
        _IERC20(tB).safeTransferFrom(msg.sender, address(this), aB);

        Locals memory l = Locals({
            rA: p.rA,
            rB: p.rB,
            totLiq: p.totLiq,
            lastTs: p.t
        });

        uint256 liq;
        if (l.lastTs == 0) {
            liq = _sqrt(aA * aB) - MIN_LIQ;
            l.lastTs = uint32(block.timestamp);
        } else {
            uint256 liqA = (aA * l.totLiq) / l.rA;
            uint256 liqB = (aB * l.totLiq) / l.rB;
            liq = liqA < liqB ? liqA : liqB;
        }

        uint256 prevBal = bal[k][msg.sender];
        if (prevBal > 0) _distribute(k, msg.sender);

        bal[k][msg.sender] = prevBal + liq;
        if (!provider[k][msg.sender]) {
            provider[k][msg.sender] = true;
            providers[k].push(msg.sender);
        }

        l.rA += uint112(aA);
        l.rB += uint112(aB);
        l.totLiq += liq;

        p.rA = l.rA;
        p.rB = l.rB;
        p.totLiq = l.totLiq;
        p.t = l.lastTs;

        emit Deposit(msg.sender, tA, tB, aA, aB, liq);
    }

    function withdraw(
        address tA,
        address tB,
        uint256 liq
    ) external whenNotPaused nonReentrant {
        bytes32 k = _key(tA, tB);
        Pair storage p = pairs[k];

        Locals memory l = Locals({
            rA: p.rA,
            rB: p.rB,
            totLiq: p.totLiq,
            lastTs: 0
        });

        uint256 userBal = bal[k][msg.sender];
        if (liq == 0 || liq > userBal) revert InsufficientLiquidity();

        uint256 aA;
        uint256 aB;

        address[2] memory tkns = pairTokens[k];

        if (liq == l.totLiq) {
            aA = _IERC20(tkns[0]).balanceOf(address(this));
            aB = _IERC20(tkns[1]).balanceOf(address(this));
        } else {
            aA = (liq * l.rA) / l.totLiq;
            aB = (liq * l.rB) / l.totLiq;
        }

        _distribute(k, msg.sender);
        bal[k][msg.sender] = userBal - liq;

        if (liq == l.totLiq) {
            p.rA = 0;
            p.rB = 0;
            p.totLiq = 0;
        } else {
            l.rA = uint112(l.rA - aA);
            l.rB = uint112(l.rB - aB);
            l.totLiq = l.totLiq - liq;
            p.rA = l.rA;
            p.rB = l.rB;
            p.totLiq = l.totLiq;
        }

        _IERC20(tkns[0]).safeTransfer(msg.sender, aA);
        _IERC20(tkns[1]).safeTransfer(msg.sender, aB);

        emit Withdraw(msg.sender, tA, tB, aA, aB);
    }

    function swap(
        address inT,
        address outT,
        uint256 amtIn,
        uint256 minOut
    ) external whenNotPaused nonReentrant returns (uint256) {
        if (inT == outT || amtIn == 0) revert InsufficientAmounts();

        bytes32 k = _key(inT, outT);
        Pair storage p = pairs[k];

        if (p.rA == 0 || p.rB == 0) revert UseForward();
        _IERC20(inT).safeTransferFrom(msg.sender, address(this), amtIn);

        Locals memory l = Locals({rA: p.rA, rB: p.rB, totLiq: 0, lastTs: 0});

        uint256 feeAmt = (amtIn * swapFee) / FEE_DEN;
        uint256 netInput = amtIn - feeAmt;

        address token0 = pairTokens[k][0];
        uint256 reserveIn = inT == token0 ? l.rA : l.rB;
        uint256 reserveOut = inT == token0 ? l.rB : l.rA;

        uint256 outAmt = reserveOut -
            ((reserveIn * reserveOut) / (reserveIn + netInput));

        if (outAmt < minOut) revert HighSlippage();

        if (inT == token0) {
            l.rA = uint112(l.rA + netInput);
            l.rB = uint112(l.rB - outAmt);
            p.accFeeA += feeAmt;
        } else {
            l.rB = uint112(l.rB + netInput);
            l.rA = uint112(l.rA - outAmt);
            p.accFeeB += feeAmt;
        }

        p.rA = l.rA;
        p.rB = l.rB;
        p.t = uint32(block.timestamp);

        _IERC20(outT).safeTransfer(msg.sender, outAmt);
        emit Swap(msg.sender, inT, outT, amtIn, outAmt);
        return outAmt;
    }

    function claimFees(address tA, address tB) external nonReentrant {
        bytes32 k = _key(tA, tB);
        _distribute(k, msg.sender);
    }

    function _distribute(bytes32 k, address user) private {
    Pair storage p = pairs[k];
    uint256 totalA = p.accFeeA;
    uint256 totalB = p.accFeeB;
    uint256 userBal = bal[k][user];

    if (userBal > 0 && p.totLiq > 0) {
        uint256 shareA = (totalA * userBal) / p.totLiq;
        uint256 shareB = (totalB * userBal) / p.totLiq;
        uint256 owedA = shareA > debtA[k][user] ? shareA - debtA[k][user] : 0;
        uint256 owedB = shareB > debtB[k][user] ? shareB - debtB[k][user] : 0;

        address[2] memory tkns = pairTokens[k];

        if (owedA > 0) {
    debtA[k][user] += owedA;
    _IERC20(tkns[0]).transfer(user, owedA);
}
if (owedB > 0) {
    debtB[k][user] += owedB;
    _IERC20(tkns[1]).transfer(user, owedB);
}
    }
}

    function distributeFees(
        address tA,
        address tB
    ) external nonReentrant onlyOwner {
        bytes32 k = _key(tA, tB);
        Pair storage p = pairs[k];

        Locals memory l = Locals({rA: p.rA, rB: p.rB, totLiq: 0, lastTs: 0});
        uint256 feesA = p.accFeeA;
        uint256 feesB = p.accFeeB;

        if (l.rA == 0 && l.rB == 0) revert UnexistingPair();
        if (feesA == 0 && feesB == 0) revert NoFees();

        l.rA += uint112(feesA);
        l.rB += uint112(feesB);

        p.rA = l.rA;
        p.rB = l.rB;
        p.accFeeA = 0;
        p.accFeeB = 0;

        emit FeesDistributed(k, feesA, feesB);
    }

    function forwardToUniswap(
        address inT,
        address outT,
        uint256 amt,
        uint256 minOut
    ) external whenNotPaused nonReentrant returns (uint256) {
        if (inT == address(0) || outT == address(0)) revert ZeroAddress();
        if (inT == outT) revert IdenticalTokens();
        if (amt == 0) revert InsufficientAmounts();

        _IERC20(inT).transferFrom(msg.sender, address(this), amt);

        uint256 fee = (amt * ADD_NUM) / ADD_DEN;
        uint256 netAmt = amt - fee;
        _IERC20(inT).transfer(owner(), fee);

        _IERC20(inT).approve(address(router), netAmt);

        address[] memory path = new address[](2);
        path[0] = inT;
        path[1] = outT;
        uint256[] memory results = router.swapExactTokensForTokens(
            netAmt,
            minOut,
            path,
            msg.sender,
            block.timestamp
        );

        _IERC20(inT).approve(address(router), 0);

        uint256 out = results[1];
        emit Forward(inT, outT, amt, out);
        return out;
    }

    function getAmountOut(
        uint256 amountIn,
        address inT,
        address outT
    ) public view returns (uint256 amountOut) {
        if (inT == address(0) || outT == address(0)) revert ZeroAddress();
        if (inT == outT) revert IdenticalTokens();
        if (amountIn == 0) revert InsufficientAmounts();

        bytes32 k = _key(inT, outT);
        Pair storage p = pairs[k];
        if (p.rA == 0 || p.rB == 0) revert NoLiquidity();

        uint256 amountInWithFee = amountIn * (FEE_DEN - swapFee);

        address token0 = pairTokens[k][0];

        uint256 reserveIn = (inT == token0) ? p.rA : p.rB;
        uint256 reserveOut = (inT == token0) ? p.rB : p.rA;

        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DEN + amountInWithFee;

        return numerator / denominator;
    }

    function getPairInfo(
        address tA,
        address tB
    )
        external
        view
        returns (
            address _token0,
            address _token1,
            uint112 _reserveA,
            uint112 _reserveB,
            uint256 _totalLiquidity,
            uint256 _accFeeA,
            uint256 _accFeeB
        )
    {
        bytes32 k = _key(tA, tB);
        Pair storage p = pairs[k];
        address[2] memory tkns = pairTokens[k];

        _token0 = tkns[0];
        _token1 = tkns[1];
        _reserveA = p.rA;
        _reserveB = p.rB;
        _totalLiquidity = p.totLiq;
        _accFeeA = p.accFeeA;
        _accFeeB = p.accFeeB;
    }

    function getLPBalance(
        address user,
        address tA,
        address tB
    ) external view returns (uint256) {
        bytes32 k = _key(tA, tB);
        return bal[k][user];
    }

    function getLPProviders(
        address tA,
        address tB
    ) external view returns (address[] memory) {
        bytes32 k = _key(tA, tB);
        return providers[k];
    }

    function getKey(address a, address b) public pure returns (bytes32) {
        return _key(a, b);
    }

    function getReserves(
        address tA,
        address tB
    )
        external
        view
        returns (uint112 reserveA, uint112 reserveB, uint32 timestamp)
    {
        bytes32 k = _key(tA, tB);
        Pair storage p = pairs[k];
        reserveA = p.rA;
        reserveB = p.rB;
        timestamp = p.t;
    }

    function feesCollected(
        bytes32 pairKey
    ) external view returns (uint256 feeA, uint256 feeB) {
        Pair storage p = pairs[pairKey];
        feeA = p.accFeeA;
        feeB = p.accFeeB;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
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
