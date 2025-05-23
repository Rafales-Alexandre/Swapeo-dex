import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { SwapeoDEX, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("SwapeoDistributeFees", function () {
  let swapeo: SwapeoDEX;
  let tokenA: MockERC20;
  let tokenB: MockERC20;
  let owner: HardhatEthersSigner;
  let addr1: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = (await MockToken.deploy("Token A", "TKA", 18)) as MockERC20;
    tokenB = (await MockToken.deploy("Token B", "TKB", 18)) as MockERC20;

    const SwapeoDEXFactory = await ethers.getContractFactory("SwapeoDEX");
    swapeo = (await SwapeoDEXFactory.deploy("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", 3)) as SwapeoDEX;

    await Promise.all([
      tokenA.waitForDeployment(),
      tokenB.waitForDeployment(),
      swapeo.waitForDeployment(),
    ]);

    await tokenA.approve(await swapeo.getAddress(), ethers.parseEther("100"));
    await tokenB.approve(await swapeo.getAddress(), ethers.parseEther("100"));

    await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), ethers.parseEther("100"), ethers.parseEther("100"));

    await tokenA.transfer(addr1.address, ethers.parseEther("10"));
    await tokenA.connect(addr1).approve(await swapeo.getAddress(), ethers.parseEther("10"));

    const amountIn = ethers.parseEther("1");
    const amountOutMin = await swapeo.getAmountOut(amountIn, await tokenA.getAddress(), await tokenB.getAddress());
    await swapeo.connect(addr1).swap(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      amountIn,
      amountOutMin - amountOutMin / BigInt(100)
    );
  });

  describe("Happy path", function () {
    it("test_distributeFees_succeedsAndUpdatesReserves", async function () {
      const [token0, token1] =
        (await tokenA.getAddress()).toLowerCase() < (await tokenB.getAddress()).toLowerCase()
          ? [await tokenA.getAddress(), await tokenB.getAddress()]
          : [await tokenB.getAddress(), await tokenA.getAddress()];

      const pairKey = await swapeo.getKey(token0, token1);

      const pairBefore = await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());

      const [feeA, feeB] = await swapeo.feesCollected(pairKey);
      const totalFees = feeA + feeB;
      expect(totalFees).to.be.gt(0);

      await expect(swapeo.distributeFees(await tokenA.getAddress(), await tokenB.getAddress()))
        .to.emit(swapeo, "FeesDistributed")
        .withArgs(pairKey, feeA, feeB);

      const pairAfter = await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());

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
        swapeo.connect(addr1).distributeFees(await tokenA.getAddress(), await tokenB.getAddress())
      ).to.be.reverted;
    });

    it("test_distributeFees_revertsIfNoFees", async function () {
      const [token0, token1] =
        (await tokenA.getAddress()).toLowerCase() < (await tokenB.getAddress()).toLowerCase()
          ? [await tokenA.getAddress(), await tokenB.getAddress()]
          : [await tokenB.getAddress(), await tokenA.getAddress()];

      const pairKey = ethers.keccak256(
        ethers.solidityPacked(["address", "address"], [token0, token1])
      );

      await swapeo.distributeFees(await tokenA.getAddress(), await tokenB.getAddress());

      await expect(
        swapeo.distributeFees(await tokenA.getAddress(), await tokenB.getAddress())
      ).to.be.revertedWithCustomError(swapeo, "NoFees");
    });

    it("test_distributeFees_revertsIfPairDoesNotExist", async function () {
      const MockToken = await ethers.getContractFactory("MockERC20");
      const tokenX = (await MockToken.deploy("Token X", "TKX", 18)) as MockERC20;
      const tokenY = (await MockToken.deploy("Token Y", "TKY", 18)) as MockERC20;
      await tokenX.waitForDeployment();
      await tokenY.waitForDeployment();

      await expect(
        swapeo.distributeFees(await tokenX.getAddress(), await tokenY.getAddress())
      ).to.be.revertedWithCustomError(swapeo, "UnexistingPair");
    });

    it("test_distributeFees_revertsWithOnlyOwnerError", async function () {
      await expect(
        swapeo.connect(addr1).distributeFees(await tokenA.getAddress(), await tokenB.getAddress())
      ).to.be.revertedWithCustomError(swapeo, "OwnableUnauthorizedAccount");
    });
  });
});
