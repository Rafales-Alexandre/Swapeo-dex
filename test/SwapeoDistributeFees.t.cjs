const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwapeoDistributeFees", function () {
  let swapeo;
  let tokenA;
  let tokenB;
  let addr1;
  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = await MockToken.deploy("Token A", "TKA", 18);
    tokenB = await MockToken.deploy("Token B", "TKB", 18);

    const SwapeoDEX = await ethers.getContractFactory("SwapeoDEX");
    swapeo = await SwapeoDEX.deploy("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",3);

    await Promise.all([
      tokenA.waitForDeployment(),
      tokenB.waitForDeployment(),
      swapeo.waitForDeployment(),
    ]);

    await tokenA.approve(swapeo.target, ethers.parseEther("100"));
    await tokenB.approve(swapeo.target, ethers.parseEther("100"));

    await swapeo.deposit(tokenA.target, tokenB.target, ethers.parseEther("100"), ethers.parseEther("100"));

    await tokenA.transfer(addr1.address, ethers.parseEther("10"));
    await tokenA.connect(addr1).approve(swapeo.target, ethers.parseEther("10"));

    const amountIn = ethers.parseEther("1");
    const amountOutMin = await swapeo.getAmountOut(amountIn, tokenA.target, tokenB.target);
    await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, amountIn, amountOutMin - amountOutMin / BigInt(100));
  });

  describe("Happy path", function () {
    it("test_distributeFees_succeedsAndUpdatesReserves", async function () {
      const [token0, token1] = tokenA.target.toLowerCase() < tokenB.target.toLowerCase()
        ? [tokenA.target, tokenB.target]
        : [tokenB.target, tokenA.target];
    
      const pairKey = await swapeo.getKey(token0, token1);
    
      const pairBefore = await swapeo.getPairInfo(tokenA.target, tokenB.target);
    
      const [feeA, feeB] = await swapeo.feesCollected(pairKey);
      const totalFees = feeA + feeB;
      expect(totalFees).to.be.gt(0);
    
      await expect(swapeo.distributeFees(tokenA.target, tokenB.target))
        .to.emit(swapeo, "FeesDistributed")
        .withArgs(pairKey, feeA, feeB);
    
      const pairAfter = await swapeo.getPairInfo(tokenA.target, tokenB.target);
    
      const feesAfter = await swapeo.feesCollected(pairKey);
      expect(feesAfter[0] + feesAfter[1]).to.equal(0);
    
      const deltaA = pairAfter._reserveA - pairBefore._reserveA;
      const deltaB = pairAfter._reserveB - pairBefore._reserveB;
    
      const expectedA = feeA;
      const expectedB = feeB;
    
      expect(deltaA).to.equal(expectedA);
      if (expectedB > 0) {
        expect(deltaB).to.equal(expectedB);
      } else {
        expect(deltaB).to.equal(0);
      }
    });
    
  });

  describe("Unhappy path", function () {
    it("test_distributeFees_revertsIfNotOwner", async function () {
      await expect(
        swapeo.connect(addr1).distributeFees(tokenA.target, tokenB.target)
      ).to.be.reverted;
    });

    it("test_distributeFees_revertsIfNoFees", async function () {
      const [token0, token1] = tokenA.target.toLowerCase() < tokenB.target.toLowerCase()
        ? [tokenA.target, tokenB.target]
        : [tokenB.target, tokenA.target];

      const pairKey = ethers.keccak256(
        ethers.solidityPacked(["address", "address"], [token0, token1])
      );

      await swapeo.distributeFees(tokenA.target, tokenB.target);

      await expect(
        swapeo.distributeFees(tokenA.target, tokenB.target)
      ).to.be.revertedWithCustomError(swapeo, "NoFees");
    });

    it("test_distributeFees_revertsIfPairDoesNotExist", async function () {
      const MockToken = await ethers.getContractFactory("MockERC20");
      const tokenX = await MockToken.deploy("Token X", "TKX", 18);
      const tokenY = await MockToken.deploy("Token Y", "TKY", 18);
      await tokenX.waitForDeployment();
      await tokenY.waitForDeployment();

      await expect(
        swapeo.distributeFees(tokenX.target, tokenY.target)
      ).to.be.revertedWithCustomError(swapeo, "UnexistingPair");
    });

    it("test_distributeFees_revertsWithOnlyOwnerError", async function () {
      await expect(
        swapeo.connect(addr1).distributeFees(tokenA.target, tokenB.target)
      ).to.be.revertedWithCustomError(swapeo, "OwnableUnauthorizedAccount");

    });
  });
});