import { expect } from "chai";
import { ethers } from "hardhat";
import { SwapeoDEX, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("SwapeoGetLPBalance", function () {
  let swapeo: SwapeoDEX;
  let tokenA: MockERC20;
  let tokenB: MockERC20;
  let tokenC: MockERC20;
  let owner: HardhatEthersSigner;
  let addr1: HardhatEthersSigner;
  let addr2: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

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

    await tokenA.transfer(addr1.address, ethers.parseEther("50"));
    await tokenB.transfer(addr1.address, ethers.parseEther("50"));
    await tokenA.connect(addr1).approve(await swapeo.getAddress(), ethers.parseEther("50"));
    await tokenB.connect(addr1).approve(await swapeo.getAddress(), ethers.parseEther("50"));
    await swapeo.connect(addr1).deposit(await tokenA.getAddress(), await tokenB.getAddress(), ethers.parseEther("50"), ethers.parseEther("50"));
  });

  describe("HappyPath", function () {
    it("should return correct LP balance for initial provider", async function () {
      const balance = await swapeo.getLPBalance(owner.address, await tokenA.getAddress(), await tokenB.getAddress());
      expect(balance).to.be.gt(0);
    });

    it("should return correct LP balance for a second provider", async function () {
      const balance = await swapeo.getLPBalance(addr1.address, await tokenA.getAddress(), await tokenB.getAddress());
      expect(balance).to.be.gt(0);
    });

    it("should return zero for a user who never provided", async function () {
      const balance = await swapeo.getLPBalance(addr2.address, await tokenA.getAddress(), await tokenB.getAddress());
      expect(balance).to.equal(0);
    });

    it("should be order-agnostic", async function () {
      const b1 = await swapeo.getLPBalance(owner.address, await tokenA.getAddress(), await tokenB.getAddress());
      const b2 = await swapeo.getLPBalance(owner.address, await tokenB.getAddress(), await tokenA.getAddress());
      expect(b1).to.equal(b2);
    });
  });

  describe("UnhappyPath", function () {
    it("should revert for same token as both pair sides", async function () {
  await expect(
    swapeo.getLPBalance(owner.address, await tokenA.getAddress(), await tokenA.getAddress())
  ).to.be.revertedWithCustomError(swapeo, "IdenticalTokens");
});

    it("should return zero for a non-existent pair", async function () {
      const balance = await swapeo.getLPBalance(owner.address, await tokenA.getAddress(), await tokenC.getAddress());
      expect(balance).to.equal(0);
    });
  });

  describe("Fuzzing", function () {
    it("should not revert and return a bigint for random addresses", async function () {
      for (let i = 0; i < 3; i++) {
        const wallet = ethers.Wallet.createRandom();
        const balance = await swapeo.getLPBalance(wallet.address, await tokenA.getAddress(), await tokenB.getAddress());
        expect(balance).to.be.a("bigint");
      }
    });
  });
});
