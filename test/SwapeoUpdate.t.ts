import { expect } from "chai";
import { ethers } from "hardhat";
import { pack } from "@ethersproject/solidity";
import { SwapeoDEX, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("GetPairKey", function () {
  let swapeo: SwapeoDEX;
  let tokenA: MockERC20;
  let tokenB: MockERC20;
  let tokenC: MockERC20;
  let owner: HardhatEthersSigner;
  let addr1: HardhatEthersSigner;
  let addr2: HardhatEthersSigner;

  function getPairKey(tokenA: string, tokenB: string) {
    const [token0, token1] =
      tokenA.toLowerCase() < tokenB.toLowerCase()
        ? [tokenA, tokenB]
        : [tokenB, tokenA];
    return ethers.keccak256(pack(["address", "address"], [token0, token1]));
  }

  async function setUp() {
    [owner, addr1, addr2] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = (await MockToken.deploy("Token A", "TKA", 18)) as MockERC20;
    tokenB = (await MockToken.deploy("Token B", "TKB", 18)) as MockERC20;
    tokenC = (await MockToken.deploy("Token C", "TKC", 18)) as MockERC20;

    const uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    const SwapeoDEX = await ethers.getContractFactory("SwapeoDEX");
    swapeo = (await SwapeoDEX.deploy(uniswapRouterAddress, 3)) as SwapeoDEX;

    await tokenA.waitForDeployment();
    await tokenB.waitForDeployment();
    await tokenC.waitForDeployment();
    await swapeo.waitForDeployment();
  }

  beforeEach(async function () {
    await setUp();
  });

  describe("HappyPath", function () {
    it("test_getReserves_doesNotRevert_forSameTokens", async function () {
      await expect(swapeo.getReserves(tokenA.target, tokenB.target)).to.not.be.reverted;
    });

    it("test_getReserves_returnsSameValues_forDifferentOrder", async function () {
      const [reserveA1, reserveB1] = await swapeo.getReserves(tokenA.target, tokenB.target);
      const [reserveA2, reserveB2] = await swapeo.getReserves(tokenB.target, tokenA.target);
      expect(reserveA1).to.equal(reserveA2);
      expect(reserveB1).to.equal(reserveB2);
    });

    it("test_getLPBalance_isConsistent_regardlessTokenOrder", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);

      const balanceAB = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const balanceBA = await swapeo.getLPBalance(owner.address, tokenB.target, tokenA.target);

      expect(balanceAB).to.equal(balanceBA);
      expect(balanceAB).to.be.gt(0);
    });

    it("test_getPairKey_generatesUniqueKeys_forDistinctPairs", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
      const amountC = ethers.parseEther("10");

      await tokenA.approve(swapeo.target, amountA * 2n);
      await tokenB.approve(swapeo.target, amountB * 2n);
      await tokenC.approve(swapeo.target, amountC * 2n);

      await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
      await swapeo.deposit(tokenA.target, tokenC.target, amountA, amountC);
      await swapeo.deposit(tokenB.target, tokenC.target, amountB, amountC);

      const keyAB = getPairKey(tokenA.target, tokenB.target);
      const keyAC = getPairKey(tokenA.target, tokenC.target);
      const keyBC = getPairKey(tokenB.target, tokenC.target);

      expect(keyAB).to.not.equal(keyAC);
      expect(keyAB).to.not.equal(keyBC);
      expect(keyAC).to.not.equal(keyBC);
    });

    it("test_getPairKey_pairKeysMappingIsSymmetric", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");

      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);

      const keyAB = await swapeo.getKey(tokenA.target, tokenB.target);
      const keyBA = await swapeo.getKey(tokenB.target, tokenA.target);

      expect(keyAB).to.equal(keyBA);
    });

    it("test_getPairInfo_returnsOrderedTokensConsistentWithKey", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");

      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);

      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();

      const [token0, token1] =
        tokenAAddress.toLowerCase() < tokenBAddress.toLowerCase()
          ? [tokenAAddress, tokenBAddress]
          : [tokenBAddress, tokenAAddress];

      const pairInfo = await swapeo.getPairInfo(tokenA.target, tokenB.target);

      expect(pairInfo[0].toLowerCase()).to.equal(token0.toLowerCase());
      expect(pairInfo[1].toLowerCase()).to.equal(token1.toLowerCase());
    });
  });

  describe("UnhappyPath", function () {
    it("test_getReserves_doesNotRevert_onSameToken", async function () {
      await expect(swapeo.getReserves(tokenA.target, tokenA.target)).to.not.be.reverted;
    });

    it("test_getReserves_doesNotRevert_onZeroAddress", async function () {
      const zeroAddress = "0x0000000000000000000000000000000000000000";
      await expect(swapeo.getReserves(zeroAddress, tokenA.target)).to.not.be.reverted;
      await expect(swapeo.getReserves(tokenA.target, zeroAddress)).to.not.be.reverted;
    });
  });

  describe("Fuzzing", function () {
    it("test_fuzz_getReserves_consistentAcrossRandomTokenPairs", async function () {
      for (let i = 0; i < 5; i++) {
        const wallet1 = ethers.Wallet.createRandom();
        const wallet2 = ethers.Wallet.createRandom();

        await expect(swapeo.getReserves(wallet1.address, wallet2.address)).to.not.be.reverted;
        await expect(swapeo.getReserves(wallet2.address, wallet1.address)).to.not.be.reverted;

        const [reserveA1, reserveB1] = await swapeo.getReserves(wallet1.address, wallet2.address);
        const [reserveA2, reserveB2] = await swapeo.getReserves(wallet2.address, wallet1.address);

        expect(reserveA1).to.equal(reserveA2);
        expect(reserveB1).to.equal(reserveB2);
      }
    });
  });
});
