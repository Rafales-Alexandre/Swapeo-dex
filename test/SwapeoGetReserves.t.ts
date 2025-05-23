import { expect } from "chai";
import { ethers } from "hardhat";
import { SwapeoDEX, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("SwapeoGetReserves", function () {
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
    swapeo = (await SwapeoDEXFactory.deploy(
      "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
      3
    )) as SwapeoDEX;

    await Promise.all([
      tokenA.waitForDeployment(),
      tokenB.waitForDeployment(),
      tokenC.waitForDeployment(),
      swapeo.waitForDeployment(),
    ]);

    await tokenA.approve(await swapeo.getAddress(), ethers.parseEther("100"));
    await tokenB.approve(await swapeo.getAddress(), ethers.parseEther("100"));
    await swapeo.deposit(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      ethers.parseEther("100"),
      ethers.parseEther("100")
    );
  });

  describe("HappyPath", function () {
    it("test_getReserves_returnsCorrectReserves", async function () {
      const [reserveA, reserveB] = await swapeo.getReserves(
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      expect(reserveA).to.equal(ethers.parseUnits("100", 18));
      expect(reserveB).to.equal(ethers.parseUnits("100", 18));
    });

    it("test_getReserves_isSymmetric", async function () {
      const [r1A, r1B] = await swapeo.getReserves(
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      const [r2A, r2B] = await swapeo.getReserves(
        await tokenB.getAddress(),
        await tokenA.getAddress()
      );

      expect(r1A).to.equal(r2A);
      expect(r1B).to.equal(r2B);
    });

    it("test_getReserves_returnsCorrectTimestamp", async function () {
      const [, , timestampBefore] = await swapeo.getReserves(
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );

      await tokenA.transfer(addr1.address, ethers.parseEther("10"));
      await tokenA.connect(addr1).approve(
        await swapeo.getAddress(),
        ethers.parseEther("10")
      );
      const amountIn = ethers.parseEther("1");
      const minOut = await swapeo.getAmountOut(
        amountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      await swapeo
        .connect(addr1)
        .swap(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          amountIn,
          minOut - minOut / 100n
        );

      const [, , timestampAfter] = await swapeo.getReserves(
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      expect(timestampAfter).to.be.gte(timestampBefore);
    });
  });

  describe("UnhappyPath", function () {
    it("test_getReserves_withSameToken_returnsZero", async function () {
      const [reserveA, reserveB] = await swapeo.getReserves(
        await tokenA.getAddress(),
        await tokenA.getAddress()
      );
      expect(reserveA).to.equal(0);
      expect(reserveB).to.equal(0);
    });

    it("test_getReserves_withZeroAddress_returnsZero", async function () {
      const zero = ethers.ZeroAddress;
      const [reserveA, reserveB] = await swapeo.getReserves(
        zero,
        await tokenA.getAddress()
      );
      expect(reserveA).to.equal(0);
      expect(reserveB).to.equal(0);
    });

    it("test_getReserves_withNonExistentPair_returnsZero", async function () {
      const [reserveA, reserveB] = await swapeo.getReserves(
        await tokenA.getAddress(),
        await tokenC.getAddress()
      );
      expect(reserveA).to.equal(0);
      expect(reserveB).to.equal(0);
    });

    it("test_getReserves_returnsZeroForTokenWithNoLiquidity", async function () {
      const lpBalance = await swapeo.getLPBalance(
        owner.address,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      await swapeo.withdraw(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        lpBalance
      );

      const [reserveA, reserveB] = await swapeo.getReserves(
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );
      expect(reserveA).to.equal(0);
      expect(reserveB).to.equal(0);
    });
  });

  describe("Fuzzing", function () {
    it("test_fuzz_getReserves_withRandomAddresses_doesNotRevert", async function () {
      for (let i = 0; i < 5; i++) {
        const wallet1 = ethers.Wallet.createRandom();
        const wallet2 = ethers.Wallet.createRandom();

        await expect(
          swapeo.getReserves(wallet1.address, wallet2.address)
        ).to.not.be.reverted;
        await expect(
          swapeo.getReserves(wallet2.address, wallet1.address)
        ).to.not.be.reverted;

        const [reserveA, reserveB] = await swapeo.getReserves(
          wallet1.address,
          wallet2.address
        );
        const [reserveA2, reserveB2] = await swapeo.getReserves(
          wallet2.address,
          wallet1.address
        );
        expect(reserveA).to.equal(reserveA2);
        expect(reserveB).to.equal(reserveB2);
      }
    });
  });
});
