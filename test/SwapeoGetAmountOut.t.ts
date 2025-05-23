import { expect } from "chai";
import { ethers } from "hardhat";
import { SwapeoDEX, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("SwapeoGetAmountOut", function () {
    let swapeo: SwapeoDEX;
    let tokenA: MockERC20;
    let tokenB: MockERC20;
    let tokenC: MockERC20;
    let owner: HardhatEthersSigner;
    let addr1: HardhatEthersSigner;
    let addr2: HardhatEthersSigner;
    let uniswapRouterAddress: string;

    beforeEach(async function () {
        [owner, addr1, addr2] = await ethers.getSigners();

        const MockToken = await ethers.getContractFactory("MockERC20");
        tokenA = (await MockToken.deploy("Token A", "TKA", 18)) as MockERC20;
        tokenB = (await MockToken.deploy("Token B", "TKB", 18)) as MockERC20;
        tokenC = (await MockToken.deploy("Token C", "TKC", 18)) as MockERC20;

        uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

        const SwapeoDEXFactory = await ethers.getContractFactory("SwapeoDEX");
        swapeo = (await SwapeoDEXFactory.deploy(uniswapRouterAddress, 3)) as SwapeoDEX;

        await tokenA.waitForDeployment();
        await tokenB.waitForDeployment();
        await tokenC.waitForDeployment();
        await swapeo.waitForDeployment();

        const amountA = ethers.parseEther("100");
        const amountB = ethers.parseEther("200");

        await tokenA.approve(await swapeo.getAddress(), amountA);
        await tokenB.approve(await swapeo.getAddress(), amountB);
        await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB);
    });

    describe("Happy path", function () {
        it("test_getAmountOut_returnsExpectedAmount_simpleSwap", async function () {
            const amountIn = ethers.parseEther("1");

            const [reserveA, reserveB] = await swapeo.getReserves(await tokenA.getAddress(), await tokenB.getAddress());

            const amountInWithFee = amountIn * 997n;
            const numerator = amountInWithFee * reserveB;
            const denominator = reserveA * 1000n + amountInWithFee;
            const expectedAmountOut = numerator / denominator;

            const amountOut = await swapeo.getAmountOut(amountIn, await tokenA.getAddress(), await tokenB.getAddress());

            const tolerance = ethers.parseEther("0.001");
            expect(amountOut).to.be.closeTo(expectedAmountOut, tolerance);
        });

        it("test_getAmountOut_returnsSameAmountInBothDirections_whenReservesEqual", async function () {
            const amount = ethers.parseEther("100");
            await tokenA.approve(await swapeo.getAddress(), amount);
            await tokenC.approve(await swapeo.getAddress(), amount);
            await swapeo.deposit(await tokenA.getAddress(), await tokenC.getAddress(), amount, amount);

            const amountIn = ethers.parseEther("1");

            const amountOutAtoC = await swapeo.getAmountOut(
                amountIn,
                await tokenA.getAddress(),
                await tokenC.getAddress()
            );

            const amountOutCtoA = await swapeo.getAmountOut(
                amountIn,
                await tokenC.getAddress(),
                await tokenA.getAddress()
            );

            expect(amountOutAtoC).to.equal(amountOutCtoA);
        });

        it("test_getAmountOut_increasesProductXY_respectingAMMWithFees", async function () {
            const amountIn = ethers.parseEther("1");

            const pairInfo = await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());

            let reserveIn: bigint, reserveOut: bigint;
            if (pairInfo._token0.toLowerCase() === (await tokenA.getAddress()).toLowerCase()) {
                reserveIn = pairInfo._reserveA;
                reserveOut = pairInfo._reserveB;
            } else {
                reserveIn = pairInfo._reserveB;
                reserveOut = pairInfo._reserveA;
            }

            const amountOut = await swapeo.getAmountOut(amountIn, await tokenA.getAddress(), await tokenB.getAddress());

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
                await tokenA.getAddress(),
                await tokenB.getAddress()
            );

            const largeOutput = await swapeo.getAmountOut(
                largeAmount,
                await tokenA.getAddress(),
                await tokenB.getAddress()
            );

            const ratio = largeOutput * 100n / smallOutput;
            expect(ratio).to.be.lt(1000n);
            expect(ratio).to.be.gt(900n);
        });
    });

    describe("Unhappy path", function () {
        it("test_getAmountOut_revertsIfTokenAddressesAreEqual", async function () {
            await expect(
                swapeo.getAmountOut(
                    ethers.parseEther("1"),
                    await tokenA.getAddress(),
                    await tokenA.getAddress()
                )
            ).to.be.revertedWithCustomError(swapeo, "IdenticalTokens");
        });

        it("test_getAmountOut_revertsIfZeroAddressIsUsed_asInputOrOutput", async function () {
            const zeroAddress = ethers.ZeroAddress;

            await expect(
                swapeo.getAmountOut(
                    ethers.parseEther("1"),
                    zeroAddress,
                    await tokenB.getAddress()
                )
            ).to.be.revertedWithCustomError(swapeo, "ZeroAddress");

            await expect(
                swapeo.getAmountOut(
                    ethers.parseEther("1"),
                    await tokenA.getAddress(),
                    zeroAddress
                )
            ).to.be.revertedWithCustomError(swapeo, "ZeroAddress");
        });

        it("test_getAmountOut_revertsIfInputAmountIsZero", async function () {
            await expect(
                swapeo.getAmountOut(
                    0,
                    await tokenA.getAddress(),
                    await tokenB.getAddress()
                )
            ).to.be.revertedWithCustomError(swapeo, "InsufficientAmounts");
        });

        it("test_getAmountOut_revertsIfPairDoesNotExist", async function () {
            await expect(
                swapeo.getAmountOut(
                    ethers.parseEther("1"),
                    await tokenB.getAddress(),
                    await tokenC.getAddress()
                )
            ).to.be.revertedWithCustomError(swapeo, "NoLiquidity");
        });

        it("test_swap_revertsIfInputAmountTooLargeComparedToReserves", async function () {
            const hugeAmount = ethers.parseEther("1000000");

            await tokenA.approve(await swapeo.getAddress(), hugeAmount);

            await expect(
                swapeo.swap(await tokenA.getAddress(), await tokenB.getAddress(), hugeAmount, 0)
            ).to.be.reverted;
        });
    });

    describe("Fee calculations", function () {
        it("test_getAmountOut_appliesSwapFeeCorrectly_0_3_percent", async function () {
            const amountIn = ethers.parseEther("100");
            const [reserveA, reserveB] = await swapeo.getReserves(await tokenA.getAddress(), await tokenB.getAddress());

            const amountOut = await swapeo.getAmountOut(
                amountIn,
                await tokenA.getAddress(),
                await tokenB.getAddress()
            );

            const amountInWithFee = amountIn * 997n;
            const numerator = amountInWithFee * reserveB;
            const denominator = reserveA * 1000n + amountInWithFee;
            const expectedAmountOut = numerator / denominator;

            const tolerance = expectedAmountOut / 1000n;
            expect(amountOut).to.be.closeTo(expectedAmountOut, tolerance);
        });

        it("test_getAmountOut_isStableAcrossMultipleCalls_sameInputAmount", async function () {
            const amountIn = ethers.parseEther("1");

            const amounts: bigint[] = [];
            for (let i = 0; i < 5; i++) {
                const amountOut = await swapeo.getAmountOut(
                    amountIn,
                    await tokenA.getAddress(),
                    await tokenB.getAddress()
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

            const outputs: bigint[] = [];
            for (const amount of amounts) {
                const out = await swapeo.getAmountOut(
                    amount,
                    await tokenA.getAddress(),
                    await tokenB.getAddress()
                );
                outputs.push(out);
            }

            const ratios: bigint[] = [];
            for (let i = 0; i < outputs.length; i++) {
                ratios.push(outputs[i] * 100n / (amounts[i] * 2n));
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
                await tokenA.getAddress(),
                await tokenB.getAddress()
            );

            const smallOutput = await swapeo.getAmountOut(
                smallAmount,
                await tokenA.getAddress(),
                await tokenB.getAddress()
            );

            const tinyRate = (tinyOutput * 1_000_000n) / tinyAmount;
            const smallRate = (smallOutput * 1_000_000n) / smallAmount;

            const rateRatio = (tinyRate * 100n) / smallRate;

            expect(rateRatio).to.be.gte(98n);
        });
    });

    describe("Fuzzing", function () {
        it("test_fuzz_getAmountOut_shouldNotRevertOnValidInput", async function () {
            const [reserveA, reserveB] = await swapeo.getReserves(await tokenA.getAddress(), await tokenB.getAddress());

            for (let i = 1; i <= 10; i++) {
                const randomAmount = ethers.parseEther((Math.random() * 10 + 0.1).toFixed(3));

                expect(randomAmount).to.be.lt(reserveA);

                const result = await swapeo.getAmountOut(
                    randomAmount,
                    await tokenA.getAddress(),
                    await tokenB.getAddress()
                );

                expect(result).to.be.a("bigint");
                expect(result).to.be.gt(0n);
                expect(result).to.be.lte(reserveB);
            }
        });
    });
});
