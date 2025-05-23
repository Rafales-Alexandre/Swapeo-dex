import { expect } from "chai";
import { ethers } from "hardhat";
import { SwapeoDEX, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("SwapeoGetPairInfo", function () {
  let swapeo: SwapeoDEX;
  let tokenA: MockERC20;
  let tokenB: MockERC20;
  let tokenC: MockERC20;
  let owner: HardhatEthersSigner;
  let addr1: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = (await MockToken.deploy("Token A", "TKA", 18)) as MockERC20;
    tokenB = (await MockToken.deploy("Token B", "TKB", 18)) as MockERC20;
    tokenC = (await MockToken.deploy("Token C", "TKC", 18)) as MockERC20;

    const SwapeoDEXFactory = await ethers.getContractFactory("SwapeoDEX");
    swapeo = (await SwapeoDEXFactory.deploy("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", 3)) as SwapeoDEX;

    await Promise.all([
      tokenA.waitForDeployment(),
      tokenB.waitForDeployment(),
      tokenC.waitForDeployment(),
      swapeo.waitForDeployment()
    ]);

    await tokenA.approve(await swapeo.getAddress(), ethers.parseEther("100"));
    await tokenB.approve(await swapeo.getAddress(), ethers.parseEther("100"));
    await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), ethers.parseEther("100"), ethers.parseEther("100"));
  });

  describe("HappyPath", function () {
    it("test_getPairInfo_returnsCorrectValues", async function () {
      const [tokenAddrA, tokenAddrB, reserveA, reserveB, totalLiquidity, accFeeA, accFeeB] =
        await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());

      expect(tokenAddrA).to.equal(await tokenA.getAddress());
      expect(tokenAddrB).to.equal(await tokenB.getAddress());
      expect(reserveA).to.equal(ethers.parseEther("100"));
      expect(reserveB).to.equal(ethers.parseEther("100"));
      expect(totalLiquidity).to.be.gt(0);
      expect(accFeeA).to.equal(0);
      expect(accFeeB).to.equal(0);
    });

    it("test_getPairInfo_orderIndependence", async function () {
      const info1 = await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());
      const info2 = await swapeo.getPairInfo(await tokenB.getAddress(), await tokenA.getAddress());

      expect(info1).to.deep.equal(info2);
    });

    it("test_getPairInfo_afterSwap_reflectsUpdatedReservesAndFees", async function () {
      await tokenA.transfer(addr1.address, ethers.parseEther("10"));
      await tokenA.connect(addr1).approve(await swapeo.getAddress(), ethers.parseEther("10"));

      const before = await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());
      const [token0, , reserveBeforeA, reserveBeforeB] = before;

      const amountIn = ethers.parseEther("1");
      const amountOutMin = await swapeo.getAmountOut(amountIn, await tokenA.getAddress(), await tokenB.getAddress());
      await swapeo.connect(addr1).swap(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountIn,
        amountOutMin - amountOutMin / 100n
      );

      const after = await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());
      const [, , reserveAfterA, reserveAfterB, , accFeeA, accFeeB] = after;

      const isToken0Input = token0 === await tokenA.getAddress();

      if (isToken0Input) {
        expect(reserveAfterA).to.be.gt(reserveBeforeA);
        expect(reserveAfterB).to.be.lt(reserveBeforeB);
        expect(accFeeA).to.be.gt(0);
      } else {
        expect(reserveAfterB).to.be.gt(reserveBeforeB);
        expect(reserveAfterA).to.be.lt(reserveBeforeA);
        expect(accFeeB).to.be.gt(0);
      }
    });

    it("test_getPairInfo_afterDistributeFees_resetsFeesCollected", async function () {
      await tokenA.transfer(addr1.address, ethers.parseEther("10"));
      await tokenA.connect(addr1).approve(await swapeo.getAddress(), ethers.parseEther("10"));

      const amountIn = ethers.parseEther("1");
      const amountOutMin = await swapeo.getAmountOut(amountIn, await tokenA.getAddress(), await tokenB.getAddress());
      await swapeo.connect(addr1).swap(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountIn,
        amountOutMin - amountOutMin / 100n
      );

      await swapeo.distributeFees(await tokenA.getAddress(), await tokenB.getAddress());

      const [, , , , , accFeeA, accFeeB] = await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());
      expect(accFeeA).to.equal(0);
      expect(accFeeB).to.equal(0);
    });

    it("test_getPairInfo_and_getReserves_shouldMatch", async function () {
      const pairInfo = await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());
      const reserves = await swapeo.getReserves(await tokenA.getAddress(), await tokenB.getAddress());

      const reserveFromInfoA = pairInfo[2];
      const reserveFromInfoB = pairInfo[3];
      const reserveFromGetReservesA = reserves[0];
      const reserveFromGetReservesB = reserves[1];

      expect(reserveFromInfoA).to.equal(reserveFromGetReservesA);
      expect(reserveFromInfoB).to.equal(reserveFromGetReservesB);
    });

    it("test_getReserves_blockTimestampLast_shouldUpdateAfterSwap", async function () {
      await tokenA.transfer(addr1.address, ethers.parseEther("10"));
      await tokenA.connect(addr1).approve(await swapeo.getAddress(), ethers.parseEther("10"));

      const [, , timestampBefore] = await swapeo.getReserves(await tokenA.getAddress(), await tokenB.getAddress());

      const amountIn = ethers.parseEther("1");
      const minOut = await swapeo.getAmountOut(amountIn, await tokenA.getAddress(), await tokenB.getAddress());
      await swapeo.connect(addr1).swap(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountIn,
        minOut - minOut / 100n
      );

      const [, , timestampAfter] = await swapeo.getReserves(await tokenA.getAddress(), await tokenB.getAddress());

      expect(timestampAfter).to.be.gt(timestampBefore);
    });

    it("test_getReserves_blockTimestampLast_isInitialized", async function () {
      const [, , timestamp] = await swapeo.getReserves(await tokenA.getAddress(), await tokenB.getAddress());
      expect(timestamp).to.be.gt(0);
    });

  });

  describe("UnhappyPath", function () {
    it("test_getPairInfo_returnsZeroForNonExistentPair", async function () {
      const [tokenAddrA, tokenAddrB, reserveA, reserveB, totalLiquidity, feesCollected] =
        await swapeo.getPairInfo(await tokenA.getAddress(), await tokenC.getAddress());

      expect(tokenAddrA).to.equal(ethers.ZeroAddress);
      expect(tokenAddrB).to.equal(ethers.ZeroAddress);
      expect(reserveA).to.equal(0);
      expect(reserveB).to.equal(0);
      expect(totalLiquidity).to.equal(0);
      expect(feesCollected).to.equal(0);
    });

    it("test_getPairInfo_withIdenticalTokens_returnsZero", async function () {
      const [tokenAddrA, tokenAddrB, reserveA, reserveB, totalLiquidity, feesCollected] =
        await swapeo.getPairInfo(await tokenA.getAddress(), await tokenA.getAddress());

      expect(tokenAddrA).to.equal(ethers.ZeroAddress);
      expect(tokenAddrB).to.equal(ethers.ZeroAddress);
      expect(reserveA).to.equal(0);
      expect(reserveB).to.equal(0);
      expect(totalLiquidity).to.equal(0);
      expect(feesCollected).to.equal(0);
    });
  });

  describe("Fuzzing", function () {
    it("test_fuzz_getPairInfo_withRandomAddresses_doesNotRevert", async function () {
      for (let i = 0; i < 5; i++) {
        const wallet1 = ethers.Wallet.createRandom();
        const wallet2 = ethers.Wallet.createRandom();

        await expect(swapeo.getPairInfo(wallet1.address, wallet2.address)).to.not.be.reverted;
        await expect(swapeo.getPairInfo(wallet2.address, wallet1.address)).to.not.be.reverted;
      }
    });
  });
});
