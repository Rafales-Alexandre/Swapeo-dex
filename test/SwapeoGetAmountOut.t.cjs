const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwapeoGetAmountOut", function () {
    let swapeo;
    let tokenA;
    let tokenB;
    let tokenC;
    let owner;
    let addr1;
    let addr2;
    let uniswapRouterAddress;

    beforeEach(async function () {
        try {
            [owner, addr1, addr2] = await ethers.getSigners();

            const MockToken = await ethers.getContractFactory("MockERC20");
            tokenA = await MockToken.deploy("Token A", "TKA", 18);
            tokenB = await MockToken.deploy("Token B", "TKB", 18);
            tokenC = await MockToken.deploy("Token C", "TKC", 18);

            uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

            const SwapeoDEX = await ethers.getContractFactory("SwapeoDEX");
            swapeo = await SwapeoDEX.deploy(uniswapRouterAddress,3);

            await tokenA.waitForDeployment();
            await tokenB.waitForDeployment();
            await tokenC.waitForDeployment();
            await swapeo.waitForDeployment();

            const amountA = ethers.parseEther("100");
            const amountB = ethers.parseEther("200");

            await tokenA.approve(swapeo.target, amountA);
            await tokenB.approve(swapeo.target, amountB);
            await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
        } catch (error) {
            console.error("Erreur lors du beforeEach :", error);
            throw error;
        }
    });

    describe("Happy path", function () {
        it("test_getAmountOut_returnsExpectedAmount_simpleSwap", async function () {
            const amountIn = ethers.parseEther("1");

            const [reserveA, reserveB] = await swapeo.getReserves(tokenA.target, tokenB.target);

            const amountInWithFee = amountIn * BigInt(997);
            const numerator = amountInWithFee * reserveB;
            const denominator = reserveA * BigInt(1000) + amountInWithFee;
            const expectedAmountOut = numerator / denominator;

            const amountOut = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);

            const tolerance = ethers.parseEther("0.001");
            expect(amountOut).to.be.closeTo(expectedAmountOut, tolerance);
        });

        it("test_getAmountOut_returnsSameAmountInBothDirections_whenReservesEqual", async function () {
            const amount = ethers.parseEther("100");
            await tokenA.approve(swapeo.target, amount);
            await tokenC.approve(swapeo.target, amount);
            await swapeo.deposit(tokenA.target, tokenC.target, amount, amount);

            const amountIn = ethers.parseEther("1");

            const amountOutAtoC = await swapeo.getAmountOut(
                amountIn,
                tokenA.target,
                tokenC.target
            );

            const amountOutCtoA = await swapeo.getAmountOut(
                amountIn,
                tokenC.target,
                tokenA.target
            );

            expect(amountOutAtoC).to.equal(amountOutCtoA);
        });

        it("test_getAmountOut_increasesProductXY_respectingAMMWithFees", async function () {
            const amountIn = ethers.parseEther("1");

            const pairInfo = await swapeo.getPairInfo(tokenA.target, tokenB.target);

            let reserveIn, reserveOut;
            if (pairInfo._token0.toLowerCase() === tokenA.getAddress()) {
                reserveIn  = pairInfo._reserveA;
                reserveOut = pairInfo._reserveB;
            } else {
                reserveIn  = pairInfo._reserveB;
                reserveOut = pairInfo._reserveA;
            }

            const amountOut = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);

            const amountInMinusFee = amountIn * 997n / 1000n;
            const newReserveIn = reserveIn + amountInMinusFee;
            const newReserveOut = reserveOut - amountOut;

            const productBefore = reserveIn * reserveOut;
            const productAfter = newReserveIn * newReserveOut;

            expect(productAfter).to.be.gt(productBefore);

            const difference = productAfter - productBefore;
            const maxAllowedIncrease = productBefore * 3n / 1000n;
            expect(difference).to.be.lte(maxAllowedIncrease);
        });







        it("test_getAmountOut_outputsRoughlyProportional_forDifferentInputSizes", async function () {
            const smallAmount = ethers.parseEther("1");
            const largeAmount = ethers.parseEther("10");

            const smallOutput = await swapeo.getAmountOut(
                smallAmount,
                tokenA.target,
                tokenB.target
            );

            const largeOutput = await swapeo.getAmountOut(
                largeAmount,
                tokenA.target,
                tokenB.target
            );

            const ratio = largeOutput * BigInt(100) / smallOutput;
            expect(ratio).to.be.lt(BigInt(1000));
            expect(ratio).to.be.gt(BigInt(900));
        });
    });

    describe("Unhappy path", function () {
        it("test_getAmountOut_revertsIfTokenAddressesAreEqual", async function () {
            await expect(
                swapeo.getAmountOut(
                    ethers.parseEther("1"),
                    tokenA.target,
                    tokenA.target
                )
            ).to.be.revertedWithCustomError(swapeo, "IdenticalTokens");
        });

        it("test_getAmountOut_revertsIfZeroAddressIsUsed_asInputOrOutput", async function () {
            const zeroAddress = "0x0000000000000000000000000000000000000000";

            await expect(
                swapeo.getAmountOut(
                    ethers.parseEther("1"),
                    zeroAddress,
                    tokenB.target
                )
            ).to.be.revertedWithCustomError(swapeo, "ZeroAddress");

            await expect(
                swapeo.getAmountOut(
                    ethers.parseEther("1"),
                    tokenA.target,
                    zeroAddress
                )
            ).to.be.revertedWithCustomError(swapeo, "ZeroAddress");
        });

        it("test_getAmountOut_revertsIfInputAmountIsZero", async function () {
            await expect(
                swapeo.getAmountOut(
                    0,
                    tokenA.target,
                    tokenB.target
                )
            ).to.be.revertedWithCustomError(swapeo, "InsufficientAmounts");
        });

        it("test_getAmountOut_revertsIfPairDoesNotExist", async function () {
            await expect(
                swapeo.getAmountOut(
                    ethers.parseEther("1"),
                    tokenB.target,
                    tokenC.target
                )
            ).to.be.revertedWithCustomError(swapeo, "NoLiquidity");
        });

        it("test_swap_revertsIfInputAmountTooLargeComparedToReserves", async function () {
            const hugeAmount = ethers.parseEther("1000000");

            await tokenA.approve(swapeo.target, hugeAmount);

            await expect(
                swapeo.swap(tokenA.target, tokenB.target, hugeAmount, 0)
            ).to.be.reverted;
        });

    });

    describe("Fee calculations", function () {
        it("test_getAmountOut_appliesSwapFeeCorrectly_0_3_percent", async function () {
            const amountIn = ethers.parseEther("100");
            const [reserveA, reserveB] = await swapeo.getReserves(tokenA.target, tokenB.target);

            const amountOut = await swapeo.getAmountOut(
                amountIn,
                tokenA.target,
                tokenB.target
            );

            const amountInWithFee = amountIn * BigInt(997);
            const numerator = amountInWithFee * reserveB;
            const denominator = reserveA * BigInt(1000) + amountInWithFee;
            const expectedAmountOut = numerator / denominator;

            const tolerance = expectedAmountOut / BigInt(1000);
            expect(amountOut).to.be.closeTo(expectedAmountOut, tolerance);
        });

        it("test_getAmountOut_isStableAcrossMultipleCalls_sameInputAmount", async function () {
            const amountIn = ethers.parseEther("1");

            const amounts = [];
            for (let i = 0; i < 5; i++) {
                const amountOut = await swapeo.getAmountOut(
                    amountIn,
                    tokenA.target,
                    tokenB.target
                );
                amounts.push(amountOut);
            }

            for (let i = 1; i < amounts.length; i++) {
                expect(amounts[i]).to.equal(amounts[0]);
            }
        });
    });

    describe("Slippage calculations", function () {
        it("test_getAmountOut_slippageIncreases_withLargerAmounts", async function () {
            const amounts = [
                ethers.parseEther("1"),
                ethers.parseEther("10"),
                ethers.parseEther("50")
            ];

            const outputs = [];
            for (const amount of amounts) {
                const out = await swapeo.getAmountOut(
                    amount,
                    tokenA.target,
                    tokenB.target
                );
                outputs.push(out);
            }

            const ratios = [];
            for (let i = 0; i < outputs.length; i++) {
                ratios.push(outputs[i] * BigInt(100) / (amounts[i] * BigInt(2)));
            }

            for (let i = 1; i < ratios.length; i++) {
                expect(ratios[i]).to.be.lt(ratios[i - 1]);
            }
        });

        it("test_getAmountOut_slippageRemainsMinimal_withSmallAmounts", async function () {
            const tinyAmount = ethers.parseEther("0.1");
            const smallAmount = ethers.parseEther("1");

            const tinyOutput = await swapeo.getAmountOut(
                tinyAmount,
                tokenA.target,
                tokenB.target
            );

            const smallOutput = await swapeo.getAmountOut(
                smallAmount,
                tokenA.target,
                tokenB.target
            );

            const tinyRate = (tinyOutput * 1_000_000n) / tinyAmount;
            const smallRate = (smallOutput * 1_000_000n) / smallAmount;

            const rateRatio = (tinyRate * 100n) / smallRate;

            expect(rateRatio).to.be.gte(98n);
        });
    });

    describe("Fuzzing", function () {
        it("test_fuzz_getAmountOut_shouldNotRevertOnValidInput", async function () {
            const [reserveA, reserveB] = await swapeo.getReserves(tokenA.target, tokenB.target);

            for (let i = 1; i <= 10; i++) {
                const randomAmount = ethers.parseEther((Math.random() * 10 + 0.1).toFixed(3));

                expect(randomAmount).to.be.lt(reserveA);

                const result = await swapeo.getAmountOut(
                    randomAmount,
                    tokenA.target,
                    tokenB.target
                );

                expect(result).to.be.a("bigint");
                expect(result).to.be.gt(0n);
                expect(result).to.be.lte(reserveB);
            }
        });
    });

}); 