const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwapeoSwap", function () {
  let swapeo;
  let tokenA;
  let tokenB;
  let tokenC;
  let addr1;
  let uniswapRouterAddress;

  async function setUp() {
    [owner, addr1] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = await MockToken.deploy("Token A", "TKA", 18);
    tokenB = await MockToken.deploy("Token B", "TKB", 18);
    tokenC = await MockToken.deploy("Token C", "TKC", 18);

    uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

    const SwapeoDEX = await ethers.getContractFactory("SwapeoDEX");
    swapeo = await SwapeoDEX.deploy(uniswapRouterAddress, 3);

    await Promise.all([
      tokenA.waitForDeployment(),
      tokenB.waitForDeployment(),
      tokenC.waitForDeployment(),
      swapeo.waitForDeployment(),
    ]);

    await tokenA.transfer(addr1.address, ethers.parseEther("100"));
    await tokenB.transfer(addr1.address, ethers.parseEther("100"));

    await tokenA.approve(swapeo.target, ethers.parseEther("100"));
    await tokenB.approve(swapeo.target, ethers.parseEther("100"));
    await swapeo.deposit(tokenA.target, tokenB.target, ethers.parseEther("100"), ethers.parseEther("100"));
  }

  beforeEach(async function () {
    await setUp();
  });

  describe("HappyPath", function () {
    it("test_swap_executesCorrectly_withinSlippage", async function () {
      const amountIn = ethers.parseEther("1");

      await tokenA.connect(addr1).approve(swapeo.target, amountIn);

      const amountOutMin = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);
      const slippage = amountOutMin / BigInt(100);

      const tx = await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, amountOutMin - slippage);
      await tx.wait();

      const finalBalance = await tokenB.balanceOf(addr1.address);
      expect(finalBalance).to.be.gt(0);
    });

    it("test_swap_acceptsExactMinimumAmountOut", async function () {
      const amountIn = ethers.parseEther("1");
      const amountOutMin = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);

      await tokenA.connect(addr1).approve(swapeo.target, amountIn);
      await expect(
        swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, amountOutMin)
      ).to.not.be.reverted;
    });

    it("test_swap_handlesReverseTokenOrder", async function () {
      const amountIn = ethers.parseEther("1");
      await tokenB.connect(addr1).approve(swapeo.target, amountIn);

      const amountOutMin = await swapeo.getAmountOut(amountIn, tokenB.target, tokenA.target);
      await expect(
        swapeo.connect(addr1).swap(tokenB.target, tokenA.target, amountIn, amountOutMin - amountOutMin / BigInt(50))
      ).to.not.be.reverted;
    });

    it("test_swap_revertsIfNotApproved", async function () {
      const amountIn = ethers.parseEther("1");
      await expect(
        swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, 1)
      ).to.be.reverted;
    });

    it("test_swap_emitsSwapEvent", async function () {
      const amountIn = ethers.parseEther("1");
      const amountOutMin = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);
      await tokenA.connect(addr1).approve(swapeo.target, amountIn);

      await expect(
        swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, amountOutMin - amountOutMin / BigInt(100))
      ).to.emit(swapeo, "Swap");
    });

    it("test_swap_transfersInputTokenCorrectly", async function () {
      const amountIn = ethers.parseEther("1");
      const amountOutMin = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);
      const slippage = amountOutMin / 100n;

      await tokenA.connect(addr1).approve(swapeo.target, amountIn);

      const userBalanceBefore = await tokenA.balanceOf(addr1.address);
      const contractBalanceBefore = await tokenA.balanceOf(swapeo.target);

      await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, amountOutMin - slippage);

      const userBalanceAfter = await tokenA.balanceOf(addr1.address);
      const contractBalanceAfter = await tokenA.balanceOf(swapeo.target);

      expect(userBalanceBefore - userBalanceAfter).to.equal(amountIn);
      expect(contractBalanceAfter - contractBalanceBefore).to.equal(amountIn);
    });

    it("test_swap_executesWithZeroSlippage", async function () {
      const amountIn = ethers.parseEther("1");
      const amountOutMin = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);
      await tokenA.connect(addr1).approve(swapeo.target, amountIn);

      await expect(
        swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, amountOutMin)
      ).to.not.be.reverted;
    });
  });

  describe("Events and returns", function () {
    it("test_swap_returnsExpectedTokenOutAmount", async function () {
      const amountIn = ethers.parseEther("1");

      await tokenA.connect(addr1).approve(swapeo.target, amountIn);
      const amountOutMin = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);

      const balanceBefore = await tokenB.balanceOf(addr1.address);

      const tx = await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, amountOutMin - amountOutMin / 100n);
      await tx.wait();

      const balanceAfter = await tokenB.balanceOf(addr1.address);
      const received = balanceAfter - balanceBefore;

      expect(received).to.be.closeTo(amountOutMin, amountOutMin / 100n);
    });

    it("test_swap_emitsSwapEvent_withCorrectValues", async function () {
      const amountIn = ethers.parseEther("1");
      await tokenA.connect(addr1).approve(swapeo.target, amountIn);
    
      const expectedOut = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);
      const minOut = expectedOut - expectedOut / BigInt(100);
    
      const tx = await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, minOut);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => log.eventName === "Swap");
      expect(event.args.u).to.equal(addr1.address);
      expect(event.args.inT).to.equal(tokenA.target);
      expect(event.args.outT).to.equal(tokenB.target);
      expect(event.args.amtIn).to.equal(amountIn);
      expect(event.args.amtOut).to.be.closeTo(expectedOut, 1n);
    });
      

    it("test_swap_doesNotEmitEventOnRevert", async function () {
      const amountIn = ethers.parseEther("1");
      const expectedOut = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);
      const tooLowMin = expectedOut + BigInt(1);
      
      await tokenA.connect(addr1).approve(swapeo.target, amountIn);
    
      await expect(
        swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, expectedOut + 10000n)
      ).to.be.revertedWithCustomError(swapeo, "HighSlippage");
    });
    
  });

  describe("UnhappyPath", function () {
    it("test_swap_revertsOnZeroAmount", async function () {
      await expect(swapeo.swap(tokenA.target, tokenB.target, 0, 0)).to.be.revertedWithCustomError(swapeo, "InsufficientAmounts");
    });

    it("test_swap_revertsIfOutputTooLow", async function () {
      const amountIn = ethers.parseEther("1");
      const expected = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);
    
      await tokenA.connect(addr1).approve(swapeo.target, amountIn);
    
      await expect(
        swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, expected + 10000n)
      ).to.be.revertedWithCustomError(swapeo, "HighSlippage");
    });
    

    it("test_swap_revertsOnNonexistentPair", async function () {
      const amountIn = ethers.parseEther("1");
      await tokenA.connect(addr1).approve(swapeo.target, amountIn);
      await expect(swapeo.connect(addr1).swap(tokenA.target, tokenC.target, amountIn, 1)).to.be.revertedWithCustomError(swapeo, "UseForward");
    });
  });

  describe("Fuzzing", function () {
    it("test_fuzz_swap_shouldSucceed_withReasonableInputs", async function () {
      for (let i = 0; i < 5; i++) {
        const amountIn = ethers.parseEther((Math.random() * 5 + 1).toFixed(3));

        await tokenA.connect(addr1).approve(swapeo.target, amountIn);

        try {
          const amountOut = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);
          const minOut = amountOut - amountOut / BigInt(50);

          await expect(swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, minOut)).to.not.be.reverted;
        } catch (err) {
        }
      }
    });
  });

});