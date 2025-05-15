const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwapeoGetLPProviders", function () {
  let swapeo;
  let tokenA;
  let tokenB;
  let tokenC;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    this.timeout(60000);
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
      swapeo.waitForDeployment(),
    ]);

    await tokenA.transfer(addr1.address, ethers.parseEther("100"));
    await tokenB.transfer(addr1.address, ethers.parseEther("100"));
    await tokenA.transfer(addr2.address, ethers.parseEther("100"));
    await tokenB.transfer(addr2.address, ethers.parseEther("100"));

    await tokenA.approve(swapeo.target, ethers.parseEther("100"));
    await tokenB.approve(swapeo.target, ethers.parseEther("100"));
    await swapeo.deposit(tokenA.target, tokenB.target, ethers.parseEther("50"), ethers.parseEther("50"));

    await tokenA.connect(addr1).approve(swapeo.target, ethers.parseEther("100"));
    await tokenB.connect(addr1).approve(swapeo.target, ethers.parseEther("100"));
    await swapeo.connect(addr1).deposit(tokenA.target, tokenB.target, ethers.parseEther("30"), ethers.parseEther("30"));

    await tokenA.connect(addr2).approve(swapeo.target, ethers.parseEther("100"));
    await tokenB.connect(addr2).approve(swapeo.target, ethers.parseEther("100"));
    await swapeo.connect(addr2).deposit(tokenA.target, tokenB.target, ethers.parseEther("20"), ethers.parseEther("20"));
  });

  describe("HappyPath", function () {
    it("test_getLPProviders_returnsAllDepositors", async function () {
      const providers = await swapeo.getLPProviders(tokenA.target, tokenB.target);
      expect(providers).to.include.members([
        owner.address,
        addr1.address,
        addr2.address,
      ]);
      expect(providers.length).to.equal(3);
    });

    it("test_getLPProviders_orderIndependence", async function () {
      const providers1 = await swapeo.getLPProviders(tokenA.target, tokenB.target);
      const providers2 = await swapeo.getLPProviders(tokenB.target, tokenA.target);
      expect(providers2).to.deep.equal(providers1);
    });

    it("test_getLPProviders_noDuplicatesAfterMultipleDeposits", async function () {
      await swapeo.connect(addr1).deposit(tokenA.target, tokenB.target, ethers.parseEther("10"), ethers.parseEther("10"));
      const providers = await swapeo.getLPProviders(tokenA.target, tokenB.target);

      const uniqueSet = new Set(providers.map(a => a.toLowerCase()));
      expect(uniqueSet.size).to.equal(providers.length);
    });

    it("test_getLPProviders_stillListedAfterFullWithdraw", async function () {
      const lpBalance = await swapeo.getLPBalance(addr2.address, tokenA.target, tokenB.target);
      await swapeo.connect(addr2).withdraw(tokenA.target, tokenB.target, lpBalance);

      const providers = await swapeo.getLPProviders(tokenA.target, tokenB.target);
      expect(providers).to.include(addr2.address); 
    });

    it("test_getLPProviders_persistAfterDistributeFees", async function () {
      await tokenA.transfer(addr1.address, ethers.parseEther("1"));
      await tokenA.connect(addr1).approve(swapeo.target, ethers.parseEther("1"));
      const minOut = await swapeo.getAmountOut(ethers.parseEther("1"), tokenA.target, tokenB.target);
      await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, ethers.parseEther("1"), minOut - minOut / 100n);

      await swapeo.distributeFees(tokenA.target, tokenB.target);

      const providers = await swapeo.getLPProviders(tokenA.target, tokenB.target);
      expect(providers).to.include.members([owner.address, addr1.address, addr2.address]);
    });             
      
  });

  describe("UnhappyPath", function () {
    it("test_getLPProviders_returnsEmptyArrayIfNoPair", async function () {
      const providers = await swapeo.getLPProviders(tokenA.target, tokenC.target);
      expect(providers).to.be.an("array").that.is.empty;
    });

    it("test_getLPProviders_withSameToken_returnsEmptyArray", async function () {
      const providers = await swapeo.getLPProviders(tokenA.target, tokenA.target);
      expect(providers).to.be.an("array").that.is.empty;
    });
  });

  describe("Fuzzing", function () {
    it("test_fuzz_getLPProviders_doesNotRevertWithRandomAddresses", async function () {
      for (let i = 0; i < 3; i++) {
        const wallet1 = ethers.Wallet.createRandom();
        const wallet2 = ethers.Wallet.createRandom();

        await expect(swapeo.getLPProviders(wallet1.address, wallet2.address)).to.not.be.reverted;
      }
    });
  });
});