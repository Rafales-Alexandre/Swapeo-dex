const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwapeoForwardToUniswap", function () {
  let swapeo;
  let tokenA;
  let tokenB;
  let owner;
  let addr1;
  let uniswapRouter;

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = await MockToken.deploy("Token A", "TKA", 18);
    tokenB = await MockToken.deploy("Token B", "TKB", 18);

    const MockRouter = await ethers.getContractFactory("MockUniswapRouter");
    uniswapRouter = await MockRouter.deploy();

    const SwapeoDEX = await ethers.getContractFactory("SwapeoDEX");
    swapeo = await SwapeoDEX.deploy(uniswapRouter.target, 3);

    await tokenA.waitForDeployment();
    await tokenB.waitForDeployment();
    await swapeo.waitForDeployment();
    await uniswapRouter.waitForDeployment();

    await uniswapRouter.setTokens(tokenA.target, tokenB.target);

    await tokenA.transfer(addr1.address, ethers.parseEther("100"));
    await tokenB.transfer(uniswapRouter.target, ethers.parseEther("100"));
    await tokenA.connect(addr1).approve(swapeo.target, ethers.parseEther("100"));
  });

  describe("Happy Path", function () {
    it("test_forwardToUniswap_executesWithCorrectFeeDeduction", async function () {
      const amountIn = ethers.parseEther("1");
      const expectedFee = amountIn * BigInt(5) / BigInt(1000);

      const ownerBalanceBefore = await tokenA.balanceOf(owner.address);

      const minOut = 0;
      const tx = await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, minOut);
      await tx.wait();

      const ownerBalanceAfter = await tokenA.balanceOf(owner.address);
      const feeReceived = ownerBalanceAfter - ownerBalanceBefore;

      expect(feeReceived).to.equal(expectedFee);
    });

    it("test_forwardToUniswap_transfersOutputToUser", async function () {
        const amountIn = ethers.parseEther("1");
        const tokenBBalanceBefore = await tokenB.balanceOf(addr1.address);
      
        await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, 0);
      
        const tokenBBalanceAfter = await tokenB.balanceOf(addr1.address);
        expect(tokenBBalanceAfter).to.be.gt(tokenBBalanceBefore);
      });

    it("test_forwardToUniswap_approvalResetAfterSwap", async function () {
      const amountIn = ethers.parseEther("1");

      await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, 0);

      const allowance = await tokenA.allowance(swapeo.target, uniswapRouter.target);
      expect(allowance).to.equal(0);
    });

    it("test_forwardToUniswap_emitsExpectedEvent", async function () {
        const amountIn = ethers.parseEther("1");
        const minOut = 0;
  
        await expect(
          swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, minOut)
        ).to.emit(swapeo, "Forward");
      });

      it("test_forwardToUniswap_feeIsCorrectlyCalculatedForVariousAmounts", async function () {
        const values = ["0.01", "0.1", "1", "10"];
        for (const val of values) {
          const amount = ethers.parseEther(val);
          await tokenA.transfer(addr1.address, amount);
          await tokenA.connect(addr1).approve(swapeo.target, amount);
  
          const before = await tokenA.balanceOf(owner.address);
          const tx = await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amount, 0);
          await tx.wait();
          const after = await tokenA.balanceOf(owner.address);
  
          const expectedFee = amount * BigInt(5) / BigInt(1000);
          const actualFee = after - before;
          expect(actualFee).to.equal(expectedFee);
        }
      });

      it("test_forwardToUniswap_contractDoesNotKeepInputToken", async function () {
        const amountIn = ethers.parseEther("1");
        const balanceBefore = await tokenA.balanceOf(swapeo.target);
      
        await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, 0);
      
        const balanceAfter = await tokenA.balanceOf(swapeo.target);
        expect(balanceAfter).to.equal(balanceBefore);
      });

      it("test_forwardToUniswap_inputTokenApprovalResetToZero", async function () {
        const amountIn = ethers.parseEther("1");
        await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, 0);
        const allowance = await tokenA.allowance(swapeo.target, uniswapRouter.target);
        expect(allowance).to.equal(0);
      });
  });

  describe("Unhappy Path", function () {
    it("test_forwardToUniswap_revertsOnZeroAmount", async function () {
      await expect(
        swapeo.connect(addr1).swap(tokenA.target, tokenB.target, 0, 1)
      ).to.be.revertedWithCustomError(swapeo, "InsufficientAmounts");
    });

    it("test_forwardToUniswap_revertsOnZeroAddress", async function () {
      await expect(
        swapeo.connect(addr1).swap(ethers.ZeroAddress, tokenB.target, 1, 1)
      ).to.be.revertedWithCustomError(swapeo, "ZeroAddress");
    });

    it("test_forwardToUniswap_revertsIfAllowanceTooLow", async function () {
        await tokenA.connect(addr1).approve(swapeo.getAddress(), 0);
        await expect(
            swapeo.connect(addr1).swap(tokenA.getAddress(), tokenB.getAddress(), ethers.parseEther("1"), 0)
          ).to.be.reverted;
      });
  });

  describe("Fuzzing", function () {
    it("test_fuzz_forwardToUniswap_shouldNotRevertWithReasonableAmounts", async function () {
      for (let i = 1; i <= 5; i++) {
        const amount = ethers.parseEther(i.toString());
        await tokenA.transfer(addr1.address, amount);
        await tokenA.connect(addr1).approve(swapeo.target, amount);

        await expect(
          swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amount, 1)
        ).to.not.be.reverted;
      }
    });
  });
});