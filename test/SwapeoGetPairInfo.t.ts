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
    it("should return correct values for an existing pair", async function () {
      const [addr0, addr1, reserve0, reserve1, totalLiquidity] =
        await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());
    
      const [expected0, expected1] = [await tokenA.getAddress(), await tokenB.getAddress()].sort();
    
      const expectedReserve0 = expected0 === await tokenA.getAddress()
        ? ethers.parseEther("100")
        : ethers.parseEther("100");
      const expectedReserve1 = expected1 === await tokenB.getAddress()
        ? ethers.parseEther("100")
        : ethers.parseEther("100");
    
      expect(addr0).to.equal(expected0);
      expect(addr1).to.equal(expected1);
      expect(reserve0).to.equal(ethers.parseEther("100"));
      expect(reserve1).to.equal(ethers.parseEther("100"));
      expect(totalLiquidity).to.be.gt(0);
    });
    

    it("should return the same info regardless of token order", async function () {
      const info1 = await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());
      const info2 = await swapeo.getPairInfo(await tokenB.getAddress(), await tokenA.getAddress());

      expect(info1).to.deep.equal(info2);
    });

    it("should update reserves after a swap", async function () {
      await tokenA.transfer(addr1.address, ethers.parseEther("10"));
      await tokenA.connect(addr1).approve(await swapeo.getAddress(), ethers.parseEther("10"));
    
      const [token0, token1, reserveBefore0, reserveBefore1, totalLiquidityBefore] =
        await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());
    
      const inputToken = await tokenA.getAddress();
      const outputToken = await tokenB.getAddress();
      const isToken0Input = token0 === inputToken;
    
      const amountIn = ethers.parseEther("1");
      const amountOutMin = await swapeo.getAmountOut(amountIn, inputToken, outputToken);
    
      await swapeo.connect(addr1).swap(
        inputToken,
        outputToken,
        amountIn,
        amountOutMin - amountOutMin / 100n
      );
    
      const [token0A, token1A, reserveAfter0, reserveAfter1, totalLiquidityAfter] =
        await swapeo.getPairInfo(inputToken, outputToken);
    
      if (isToken0Input) {
        expect(reserveAfter0).to.be.gt(reserveBefore0);
        expect(reserveAfter1).to.be.lt(reserveBefore1);
      } else {
        expect(reserveAfter1).to.be.gt(reserveBefore1);
        expect(reserveAfter0).to.be.lt(reserveBefore0);
      }
    });
    

    it("should match reserves between getPairInfo and getReserves", async function () {
      const pairInfo = await swapeo.getPairInfo(await tokenA.getAddress(), await tokenB.getAddress());
      const reserves = await swapeo.getReserves(await tokenA.getAddress(), await tokenB.getAddress());

      const reserveFromInfoA = pairInfo[2];
      const reserveFromInfoB = pairInfo[3];
      const reserveFromGetReservesA = reserves[0];
      const reserveFromGetReservesB = reserves[1];

      expect(reserveFromInfoA).to.equal(reserveFromGetReservesA);
      expect(reserveFromInfoB).to.equal(reserveFromGetReservesB);
    });
  });

  describe("UnhappyPath", function () {
    it("should return zeros for a non-existent pair", async function () {
      const [tokenAddrA, tokenAddrB, reserveA, reserveB, totalLiquidity] =
        await swapeo.getPairInfo(await tokenA.getAddress(), await tokenC.getAddress());

      expect(tokenAddrA).to.equal(ethers.ZeroAddress);
      expect(tokenAddrB).to.equal(ethers.ZeroAddress);
      expect(reserveA).to.equal(0);
      expect(reserveB).to.equal(0);
      expect(totalLiquidity).to.equal(0);
    });

    it("should return zero values for identical tokens", async function () {
  const [addrA, addrB, reserveA, reserveB, totalLiquidity] =
    await swapeo.getPairInfo(await tokenA.getAddress(), await tokenA.getAddress());

  expect(addrA).to.equal(ethers.ZeroAddress);
  expect(addrB).to.equal(ethers.ZeroAddress);
  expect(reserveA).to.equal(0);
  expect(reserveB).to.equal(0);
  expect(totalLiquidity).to.equal(0);
});
  });

  describe("Edge Cases", function () {
    it("should return zero values with ZeroAddress as one token", async function () {
  const [addrA, addrB, reserveA, reserveB, totalLiquidity] =
    await swapeo.getPairInfo(ethers.ZeroAddress, await tokenA.getAddress());

  expect(addrA).to.equal(ethers.ZeroAddress);
  expect(addrB).to.equal(ethers.ZeroAddress);
  expect(reserveA).to.equal(0);
  expect(reserveB).to.equal(0);
  expect(totalLiquidity).to.equal(0);
});
    
  
    it("should return zero values with both tokens as ZeroAddress", async function () {
  const [addrA, addrB, reserveA, reserveB, totalLiquidity] =
    await swapeo.getPairInfo(ethers.ZeroAddress, ethers.ZeroAddress);

  expect(addrA).to.equal(ethers.ZeroAddress);
  expect(addrB).to.equal(ethers.ZeroAddress);
  expect(reserveA).to.equal(0);
  expect(reserveB).to.equal(0);
  expect(totalLiquidity).to.equal(0);
});
  
    it("should return small (dust) values after almost all liquidity withdrawn", async function () {
      const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
      const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
      const ownerLp = await lpToken.balanceOf(owner.address);
    
      if (ownerLp > 1n) {
        await lpToken.transfer(addr1.address, ownerLp - 1n);
      }
      await swapeo.connect(addr1).withdraw(tokenA.target, tokenB.target, ownerLp - 1n);
    
      const [tokenAddrA, tokenAddrB, reserveA, reserveB, totalLiquidity, accFeeA, accFeeB] =
        await swapeo.getPairInfo(tokenA.target, tokenB.target);
    
      expect(reserveA).to.be.lte(1_000_000_000_000_000n);
      expect(reserveB).to.be.lte(1_000_000_000_000_000n);
      expect(totalLiquidity).to.be.lte(1_000_000_000_000_000n);
      expect([tokenAddrA, tokenAddrB]).to.have.members([tokenA.target, tokenB.target]);
    });
    
  
    it("should return zeros for getPairInfo on never-created pair", async function () {
      const [tokenAddrA, tokenAddrB, reserveA, reserveB, totalLiquidity] =
        await swapeo.getPairInfo(tokenA.target, tokenC.target);
  
      expect(tokenAddrA).to.equal(ethers.ZeroAddress);
      expect(tokenAddrB).to.equal(ethers.ZeroAddress);
      expect(reserveA).to.equal(0);
      expect(reserveB).to.equal(0);
      expect(totalLiquidity).to.equal(0);
    });
  
    it("should reflect correct reserves and fees after deposit -> swap -> withdraw -> deposit", async function () {
  await tokenA.approve(await swapeo.getAddress(), ethers.parseEther("10"));
  await tokenB.approve(await swapeo.getAddress(), ethers.parseEther("10"));
  await swapeo.deposit(tokenA.target, tokenB.target, ethers.parseEther("10"), ethers.parseEther("10"));

  await tokenA.transfer(addr1.address, ethers.parseEther("1"));
  await tokenA.connect(addr1).approve(await swapeo.getAddress(), ethers.parseEther("1"));
  const amountOutMin = await swapeo.getAmountOut(
    ethers.parseEther("1"),
    tokenA.target,
    tokenB.target
  );
  await swapeo.connect(addr1).swap(
    tokenA.target,
    tokenB.target,
    ethers.parseEther("1"),
    amountOutMin - 1n
  );

  const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
  const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
  const ownerLp = await lpToken.balanceOf(owner.address);
  await swapeo.withdraw(tokenA.target, tokenB.target, ownerLp / 2n);

  await tokenA.approve(await swapeo.getAddress(), ethers.parseEther("2"));
  await tokenB.approve(await swapeo.getAddress(), ethers.parseEther("2"));
  await swapeo.deposit(tokenA.target, tokenB.target, ethers.parseEther("2"), ethers.parseEther("2"));

  const [
    tokenAddrA,
    tokenAddrB,
    reserveA,
    reserveB,
    totalLiquidity,
  ] = await swapeo.getPairInfo(tokenA.target, tokenB.target);

  const [expected0, expected1] =
    tokenA.target.toLowerCase() < tokenB.target.toLowerCase()
      ? [tokenA.target, tokenB.target]
      : [tokenB.target, tokenA.target];

  expect(tokenAddrA.toLowerCase()).to.equal(expected0.toLowerCase());
  expect(tokenAddrB.toLowerCase()).to.equal(expected1.toLowerCase());
  expect(reserveA).to.be.gt(0);
  expect(reserveB).to.be.gt(0);
  expect(totalLiquidity).to.be.gt(0);
    });
  
    it("should not revert if ERC20 balanceOf throws (malicious token)", async function () {
      const EvilERC20Factory = await ethers.getContractFactory("MockERC20RevertOnBalanceOf");
      const evilToken = await EvilERC20Factory.deploy("EvilToken", "EVL");
      await expect(swapeo.getPairInfo(evilToken.target, tokenA.target)).to.not.be.reverted;
    });
  
  });
  
  describe("Fuzzing", function () {
    it("should not revert with random addresses", async function () {
      for (let i = 0; i < 5; i++) {
        const wallet1 = ethers.Wallet.createRandom();
        const wallet2 = ethers.Wallet.createRandom();

        await expect(swapeo.getPairInfo(wallet1.address, wallet2.address)).to.not.be.reverted;
        await expect(swapeo.getPairInfo(wallet2.address, wallet1.address)).to.not.be.reverted;
      }
    });
  });
});
