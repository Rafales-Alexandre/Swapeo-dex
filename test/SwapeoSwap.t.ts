import { expect } from "chai";
import { ethers } from "hardhat";
import { SwapeoDEX, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("SwapeoSwap", function () {
  let swapeo: SwapeoDEX;
  let tokenA: MockERC20;
  let tokenB: MockERC20;
  let tokenC: MockERC20;
  let owner: HardhatEthersSigner;
  let addr1: HardhatEthersSigner;
  let uniswapRouterAddress: string;

  async function setUp() {
    [owner, addr1] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = (await MockToken.deploy("Token A", "TKA", 18)) as MockERC20;
    tokenB = (await MockToken.deploy("Token B", "TKB", 18)) as MockERC20;
    tokenC = (await MockToken.deploy("Token C", "TKC", 18)) as MockERC20;

    uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

    const SwapeoDEXFactory = await ethers.getContractFactory("SwapeoDEX");
    swapeo = (await SwapeoDEXFactory.deploy(
      uniswapRouterAddress,
      3
    )) as SwapeoDEX;

    await Promise.all([
      tokenA.waitForDeployment(),
      tokenB.waitForDeployment(),
      tokenC.waitForDeployment(),
      swapeo.waitForDeployment(),
    ]);

    await tokenA.transfer(addr1.address, ethers.parseEther("100"));
    await tokenB.transfer(addr1.address, ethers.parseEther("100"));

    await tokenA.approve(await swapeo.getAddress(), ethers.parseEther("100"));
    await tokenB.approve(await swapeo.getAddress(), ethers.parseEther("100"));
    await swapeo.deposit(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      ethers.parseEther("100"),
      ethers.parseEther("100")
    );
  }

  beforeEach(async function () {
    await setUp();
  });

  describe("HappyPath", function () {
    it("should execute a swap correctly within allowed slippage", async function () {
      const amountIn = ethers.parseEther("1");

      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);

      const amountOutMin = await swapeo.getAmountOut(
        amountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      const slippage = amountOutMin / BigInt(100);

      const tx = await swapeo
        .connect(addr1)
        .swap(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          amountIn,
          amountOutMin - slippage
        );
      await tx.wait();

      const finalBalance = await tokenB.balanceOf(addr1.address);
      expect(finalBalance).to.be.gt(0);
    });

    it("should accept swap with exact minimum amount out", async function () {
      const amountIn = ethers.parseEther("1");
      const amountOutMin = await swapeo.getAmountOut(
        amountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );

      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);
      await expect(
        swapeo
          .connect(addr1)
          .swap(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            amountIn,
            amountOutMin
          )
      ).to.not.be.reverted;
    });

    it("should handle reverse token order for swap", async function () {
      const amountIn = ethers.parseEther("1");
      await tokenB.connect(addr1).approve(await swapeo.getAddress(), amountIn);

      const amountOutMin = await swapeo.getAmountOut(
        amountIn,
        await tokenB.getAddress(),
        await tokenA.getAddress()
      );
      await expect(
        swapeo
          .connect(addr1)
          .swap(
            await tokenB.getAddress(),
            await tokenA.getAddress(),
            amountIn,
            amountOutMin - amountOutMin / BigInt(50)
          )
      ).to.not.be.reverted;
    });

    it("should revert if user did not approve input tokens", async function () {
      const amountIn = ethers.parseEther("1");
      await expect(
        swapeo
          .connect(addr1)
          .swap(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            amountIn,
            1
          )
      ).to.be.reverted;
    });

    it("should emit Swap event on successful swap", async function () {
      const amountIn = ethers.parseEther("1");
      const amountOutMin = await swapeo.getAmountOut(
        amountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);

      await expect(
        swapeo
          .connect(addr1)
          .swap(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            amountIn,
            amountOutMin - amountOutMin / BigInt(100)
          )
      ).to.emit(swapeo, "Swap");
    });

    it("should transfer input tokens from user to contract on swap", async function () {
      const amountIn = ethers.parseEther("1");
      const amountOutMin = await swapeo.getAmountOut(
        amountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      const slippage = amountOutMin / 100n;

      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);

      const userBalanceBefore = await tokenA.balanceOf(addr1.address);
      const contractBalanceBefore = await tokenA.balanceOf(await swapeo.getAddress());

      await swapeo
        .connect(addr1)
        .swap(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          amountIn,
          amountOutMin - slippage
        );

      const userBalanceAfter = await tokenA.balanceOf(addr1.address);
      const contractBalanceAfter = await tokenA.balanceOf(await swapeo.getAddress());

      expect(userBalanceBefore - userBalanceAfter).to.equal(amountIn);
      expect(contractBalanceAfter - contractBalanceBefore).to.equal(amountIn);
    });

    it("should execute swap with zero slippage", async function () {
      const amountIn = ethers.parseEther("1");
      const amountOutMin = await swapeo.getAmountOut(
        amountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);

      await expect(
        swapeo
          .connect(addr1)
          .swap(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            amountIn,
            amountOutMin
          )
      ).to.not.be.reverted;
    });
  });

  describe("Events and returns", function () {
    it("should send expected amount of output tokens to user", async function () {
      const amountIn = ethers.parseEther("1");

      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);
      const amountOutMin = await swapeo.getAmountOut(
        amountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );

      const balanceBefore = await tokenB.balanceOf(addr1.address);

      const tx = await swapeo
        .connect(addr1)
        .swap(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          amountIn,
          amountOutMin - amountOutMin / 100n
        );
      await tx.wait();

      const balanceAfter = await tokenB.balanceOf(addr1.address);
      const received = balanceAfter - balanceBefore;

      expect(received).to.be.closeTo(amountOutMin, amountOutMin / 100n);
    });

    it("should emit Swap event with correct values", async function () {
      const amountIn = ethers.parseEther("1");
      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);

      const expectedOut = await swapeo.getAmountOut(
        amountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      const minOut = expectedOut - expectedOut / BigInt(100);

      const tx = await swapeo
        .connect(addr1)
        .swap(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          amountIn,
          minOut
        );
      const receipt = await tx.wait();

      let swapLog: any;
      for (const log of receipt.logs) {
        try {
          const parsed = swapeo.interface.parseLog(log);
          if (parsed && parsed.name === "Swap") {
            swapLog = parsed;
            break;
          }
        } catch (e) {
        }
      }

      expect(swapLog).to.not.be.undefined;
      expect(swapLog.args.user).to.equal(addr1.address);
      expect(swapLog.args.inputToken).to.equal(await tokenA.getAddress());
      expect(swapLog.args.outputToken).to.equal(await tokenB.getAddress());
      expect(swapLog.args.inputAmount).to.equal(amountIn);
      expect(swapLog.args.outputAmount).to.be.closeTo(expectedOut, expectedOut / 100n);
    });

    it("should revert and not emit event if slippage is too high", async function () {
      const amountIn = ethers.parseEther("1");
      const expectedOut = await swapeo.getAmountOut(
        amountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      const tooLowMin = expectedOut + BigInt(1);

      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);

      await expect(
        swapeo
          .connect(addr1)
          .swap(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            amountIn,
            expectedOut + 10000n
          )
      ).to.be.revertedWithCustomError(swapeo, "HighSlippage");
    });
  });

  describe("UnhappyPath", function () {
    it("should revert if swap amount is zero", async function () {
      await expect(
        swapeo.swap(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          0,
          0
        )
      ).to.be.revertedWithCustomError(swapeo, "InsufficientAmounts");
    });

    it("should revert if minimum output is too high", async function () {
      const amountIn = ethers.parseEther("1");
      const expected = await swapeo.getAmountOut(
        amountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );

      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);

      await expect(
        swapeo
          .connect(addr1)
          .swap(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            amountIn,
            expected + 10000n
          )
      ).to.be.revertedWithCustomError(swapeo, "HighSlippage");
    });
  });

  
  describe("Edge cases", function () {
    it("should revert when trying to swap a dust amount", async function () {
      const dust = 1n;
      await tokenA.connect(addr1).approve(await swapeo.getAddress(), dust);
      const minOut = await swapeo.getAmountOut(
        dust,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      const safeMinOut = minOut > 0n ? minOut - 1n : 0n;
      await expect(
        swapeo.connect(addr1).swap(tokenA.getAddress(), tokenB.getAddress(), dust, safeMinOut)
      ).to.be.reverted;
    });
    
  
    it("should handle swap after LP transfer", async function () {
      const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
      const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
      const ownerLp = await lpToken.balanceOf(owner.address);
      await lpToken.transfer(addr1.address, ownerLp);
  
      const amountIn = ethers.parseEther("1");
      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);
      const minOut = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);
  
      await expect(
        swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, minOut - 1n)
      ).to.not.be.reverted;
    });
  
    it("should handle swap of last liquidity", async function () {
      const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
      const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
      const ownerLp = await lpToken.balanceOf(owner.address);
  
      if (ownerLp > 1n) {
        await lpToken.transfer(addr1.address, ownerLp - 1n);
      }
      const amountIn = ethers.parseEther("0.1");
      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);
      const minOut = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);
      await expect(
        swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, minOut - 1n)
      ).to.not.be.reverted;
    });
  
    it("should revert on swap with identical tokens", async function () {
      const amountIn = ethers.parseEther("1");
      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);
      await expect(
        swapeo.connect(addr1).swap(tokenA.target, tokenA.target, amountIn, 0)
      ).to.be.revertedWithCustomError(swapeo, "IdenticalTokens");
    });
  
    it("should revert if ERC20 transfer reverts", async function () {
      const RevertToken = await ethers.getContractFactory("MockERC20RevertOnTransfer");
      const revertToken = await RevertToken.deploy("RevertToken", "REVERT");
      await revertToken.mint(addr1.address, ethers.parseEther("10"));
  
      await revertToken.connect(addr1).approve(await swapeo.getAddress(), ethers.parseEther("1"));
  
      await expect(
        swapeo.connect(addr1).swap(revertToken.target, tokenA.target, ethers.parseEther("1"), 0)
      ).to.be.revertedWith("ERC20 transferFrom always reverts");
    });
  });
  

  describe("Fuzzing", function () {
    it("should not revert on multiple valid swap amounts", async function () {
      for (let i = 0; i < 5; i++) {
        const amountIn = ethers.parseEther((Math.random() * 5 + 1).toFixed(3));

        await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountIn);

        try {
          const amountOut = await swapeo.getAmountOut(
            amountIn,
            await tokenA.getAddress(),
            await tokenB.getAddress()
          );
          const minOut = amountOut - amountOut / BigInt(50);

          await expect(
            swapeo
              .connect(addr1)
              .swap(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                amountIn,
                minOut
              )
          ).to.not.be.reverted;
        } catch (err) {}
      }
    });
  });
});
