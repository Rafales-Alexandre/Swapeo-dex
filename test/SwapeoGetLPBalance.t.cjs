const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwapeoGetLPBalance", function () {
  let swapeo;
  let tokenA;
  let tokenB;
  let tokenC;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = await MockToken.deploy("Token A", "TKA", 18);
    tokenB = await MockToken.deploy("Token B", "TKB", 18);
    tokenC = await MockToken.deploy("Token C", "TKC", 18);

    const SwapeoDEX = await ethers.getContractFactory("SwapeoDEX");
    swapeo = await SwapeoDEX.deploy("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",3);

    await Promise.all([
      tokenA.waitForDeployment(),
      tokenB.waitForDeployment(),
      tokenC.waitForDeployment(),
      swapeo.waitForDeployment()
    ]);

    await tokenA.approve(swapeo.target, ethers.parseEther("100"));
    await tokenB.approve(swapeo.target, ethers.parseEther("100"));
    await swapeo.deposit(tokenA.target, tokenB.target, ethers.parseEther("100"), ethers.parseEther("100"));

    await tokenA.transfer(addr1.address, ethers.parseEther("50"));
    await tokenB.transfer(addr1.address, ethers.parseEther("50"));
    await tokenA.connect(addr1).approve(swapeo.target, ethers.parseEther("50"));
    await tokenB.connect(addr1).approve(swapeo.target, ethers.parseEther("50"));
    await swapeo.connect(addr1).deposit(tokenA.target, tokenB.target, ethers.parseEther("50"), ethers.parseEther("50"));
  });

  describe("HappyPath", function () {
    it("test_getLPBalance_returnsCorrectValueForOwner", async function () {
      const balance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      expect(balance).to.be.gt(0);
    });

    it("test_getLPBalance_returnsCorrectValueForOtherUser", async function () {
      const balance = await swapeo.getLPBalance(addr1.address, tokenA.target, tokenB.target);
      expect(balance).to.be.gt(0);
    });

    it("test_getLPBalance_returnsZeroForNonProvider", async function () {
      const balance = await swapeo.getLPBalance(addr2.address, tokenA.target, tokenB.target);
      expect(balance).to.equal(0);
    });

    it("test_getLPBalance_symmetricOrder", async function () {
      const b1 = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const b2 = await swapeo.getLPBalance(owner.address, tokenB.target, tokenA.target);
      expect(b1).to.equal(b2);
    });
  });

  describe("UnhappyPath", function () {
    it("test_getLPBalance_withSameToken_returnsZero", async function () {
      const balance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenA.target);
      expect(balance).to.equal(0);
    });

    it("test_getLPBalance_withNonExistentPair_returnsZero", async function () {
      const balance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenC.target);
      expect(balance).to.equal(0);
    });
  });

  describe("Fuzzing", function () {
    it("test_fuzz_getLPBalance_withRandomAddresses_doesNotRevert", async function () {
      for (let i = 0; i < 3; i++) {
        const wallet = ethers.Wallet.createRandom();
        const balance = await swapeo.getLPBalance(wallet.address, tokenA.target, tokenB.target);
        expect(balance).to.be.a("bigint");
      }
    });
  });
});