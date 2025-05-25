import { ethers } from "hardhat";
import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { SwapeoDEX, MockERC20 } from "../typechain-types";
import { Signer } from "ethers";

describe("SwapeoDeposit", function () {
  let swapeo: SwapeoDEX;
  let tokenA: MockERC20;
  let tokenB: MockERC20;
  let tokenC: MockERC20;
  let owner: Signer, addr1: Signer, addr2: Signer;
  let ownerAddress: string, addr1Address: string, addr2Address: string;
  let uniswapRouterAddress: string;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    addr1Address = await addr1.getAddress();
    addr2Address = await addr2.getAddress();

    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = (await MockToken.deploy("Token A", "TKA", 18)) as MockERC20;
    tokenB = (await MockToken.deploy("Token B", "TKB", 18)) as MockERC20;
    tokenC = (await MockToken.deploy("Token C", "TKC", 18)) as MockERC20;

    uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

    const SwapeoDEXFactory = await ethers.getContractFactory("SwapeoDEX");
    swapeo = (await SwapeoDEXFactory.deploy(uniswapRouterAddress, 3)) as SwapeoDEX;

    await tokenA.waitForDeployment();
    await tokenB.waitForDeployment();
    await tokenC.waitForDeployment();
    await swapeo.waitForDeployment();

    await tokenA.transfer(addr1Address, ethers.parseEther("500"));
    await tokenB.transfer(addr1Address, ethers.parseEther("500"));
  });

  describe("Happy path", function () {
    it("mints LP tokens and emits event when creating a new pair", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
  
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
  
      await expect(
        swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB)
      ).to.emit(swapeo, "Deposit")
        .withArgs(ownerAddress, tokenA.target, tokenB.target, amountA, amountB, anyValue);
  
      const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
      const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
      expect(await lpToken.balanceOf(ownerAddress)).to.be.gt(0);
    });
  
    it("allows several deposits from the same user on one pair", async function () {
      const amountA1 = ethers.parseEther("10");
      const amountB1 = ethers.parseEther("10");
      const amountA2 = ethers.parseEther("5");
      const amountB2 = ethers.parseEther("5");
  
      await tokenA.approve(swapeo.target, amountA1 + amountA2);
      await tokenB.approve(swapeo.target, amountB1 + amountB2);
  
      await swapeo.deposit(tokenA.target, tokenB.target, amountA1, amountB1);
      const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
      const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
      const lpBalanceBefore = await lpToken.balanceOf(ownerAddress);
  
      await swapeo.deposit(tokenA.target, tokenB.target, amountA2, amountB2);
      const lpBalanceAfter = await lpToken.balanceOf(ownerAddress);
  
      expect(lpBalanceAfter).to.be.gt(lpBalanceBefore);
    });
  
    it("lets different users add liquidity to the same pair", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
  
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
  
      await tokenA.connect(addr1).approve(swapeo.target, amountA);
      await tokenB.connect(addr1).approve(swapeo.target, amountB);
      await swapeo.connect(addr1).deposit(tokenA.target, tokenB.target, amountA, amountB);
  
      const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
      const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
      expect(await lpToken.balanceOf(ownerAddress)).to.be.gt(0);
      expect(await lpToken.balanceOf(addr1Address)).to.be.gt(0);
    });
  
    it("correctly updates contract balances when tokens are deposited", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
  
      const ownerBalanceABefore = await tokenA.balanceOf(ownerAddress);
      const ownerBalanceBBefore = await tokenB.balanceOf(ownerAddress);
      const contractBalanceABefore = await tokenA.balanceOf(swapeo.target);
      const contractBalanceBBefore = await tokenB.balanceOf(swapeo.target);
  
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
  
      const ownerBalanceAAfter = await tokenA.balanceOf(ownerAddress);
      const ownerBalanceBAfter = await tokenB.balanceOf(ownerAddress);
      const contractBalanceAAfter = await tokenA.balanceOf(swapeo.target);
      const contractBalanceBAfter = await tokenB.balanceOf(swapeo.target);
  
      expect(ownerBalanceABefore - ownerBalanceAAfter).to.equal(amountA);
      expect(ownerBalanceBBefore - ownerBalanceBAfter).to.equal(amountB);
      expect(contractBalanceAAfter - contractBalanceABefore).to.equal(amountA);
      expect(contractBalanceBAfter - contractBalanceBBefore).to.equal(amountB);
    });
    it("generates correct LP token name and symbol", async function () {
      const amountA = ethers.parseEther("1");
      const amountB = ethers.parseEther("1");
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
   
      const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
      const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
   
      expect(await lpToken.name()).to.equal("Swapeo LP Token for TKA-TKB");
      expect(await lpToken.symbol()).to.equal("SWP-LP-TKA-TKB");
   });
  });
  

  describe("Unhappy path", function () {
    it("reverts if token addresses are identical", async function () {
      const amount = ethers.parseEther("10");
      await tokenA.approve(swapeo.target, amount);
  
      await expect(
        swapeo.deposit(tokenA.target, tokenA.target, amount, amount)
      ).to.be.revertedWithCustomError(swapeo, "IdenticalTokens");
    });
  
    it("reverts if one of the addresses is zero", async function () {
      const amount = ethers.parseEther("10");
      const zeroAddress = ethers.ZeroAddress;
      await tokenA.approve(swapeo.target, amount);
  
      await expect(
        swapeo.deposit(zeroAddress, tokenA.target, amount, amount)
      ).to.be.revertedWithCustomError(swapeo, "ZeroAddress");
  
      await expect(
        swapeo.deposit(tokenA.target, zeroAddress, amount, amount)
      ).to.be.revertedWithCustomError(swapeo, "ZeroAddress");
    });
  
    it("reverts if either deposited amount is zero", async function () {
      await expect(
        swapeo.deposit(tokenA.target, tokenB.target, 0, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(swapeo, "InsufficientAmounts");
  
      await expect(
        swapeo.deposit(tokenA.target, tokenB.target, ethers.parseEther("10"), 0)
      ).to.be.revertedWithCustomError(swapeo, "InsufficientAmounts");
  
      await expect(
        swapeo.deposit(tokenA.target, tokenB.target, 0, 0)
      ).to.be.revertedWithCustomError(swapeo, "InsufficientAmounts");
    });
  
    it("reverts if user tries to deposit more than their balance", async function () {
      const largeAmount = ethers.parseEther("10000");
      await tokenA.connect(addr1).approve(swapeo.target, largeAmount);
      await tokenB.connect(addr1).approve(swapeo.target, largeAmount);
  
      await expect(
        swapeo.connect(addr1).deposit(tokenA.target, tokenB.target, largeAmount, largeAmount)
      ).to.be.revertedWithCustomError(tokenA, "ERC20InsufficientBalance");
    });
  });
  

  describe("Liquidity calculations", function () {
    it("mints LP tokens correctly on first deposit", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("20");
  
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
  
      const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
      const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
      expect(await lpToken.balanceOf(ownerAddress)).to.be.gt(0);
    });
  
    it("assigns proportional LP tokens on subsequent deposits", async function () {
      const amountA1 = ethers.parseEther("100");
      const amountB1 = ethers.parseEther("100");
  
      await tokenA.approve(swapeo.target, amountA1);
      await tokenB.approve(swapeo.target, amountB1);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA1, amountB1);
  
      const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
      const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
      const lpBalance1 = await lpToken.balanceOf(ownerAddress);
  
      const amountA2 = ethers.parseEther("50");
      const amountB2 = ethers.parseEther("50");
  
      await tokenA.approve(swapeo.target, amountA2);
      await tokenB.approve(swapeo.target, amountB2);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA2, amountB2);
  
      const lpBalance2 = await lpToken.balanceOf(ownerAddress);
      const expectedIncrease = lpBalance1 / BigInt(2);
      const actualIncrease = lpBalance2 - lpBalance1;
      const tolerance = expectedIncrease / BigInt(100);
  
      expect(actualIncrease).to.be.closeTo(expectedIncrease, tolerance);
    });
  });
  

  describe("Events and returns", function () {
    it("returns the correct amount of LP tokens in event", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
  
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
  
      const tx = await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
      const receipt = await tx.wait();
  
      const events = receipt.logs
        .map((log: any) => {
          try {
            return swapeo.interface.parseLog(log);
          } catch {
            return undefined;
          }
        })
        .filter((e: any) => e && e.name === "Deposit");
  
      expect(events.length).to.be.gt(0);
  
      const depositEvent = events[0];
      const lpAmount = depositEvent!.args[5];
      const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
      const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
      expect(await lpToken.balanceOf(ownerAddress)).to.equal(lpAmount);
    });
  
    it("subtracts minimum liquidity from total on first deposit", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
  
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
  
      const pairKey = await swapeo.getKey(tokenA.target, tokenB.target);
      const pair = await swapeo.s_pairKeyToPairInfo(pairKey);
  
      expect(pair.totalLiquidity).to.be.lt(ethers.parseEther("10"));
    });
  });
  
  describe("Edge Cases", function () {
    it("deposits with reversed token order use the same LP token", async function () {
      const amount = ethers.parseEther("10");
      await tokenA.approve(swapeo.target, amount);
      await tokenB.approve(swapeo.target, amount);
  
      await swapeo.deposit(tokenA.target, tokenB.target, amount, amount);
      const lpTokenA_B = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
  
      await tokenA.approve(swapeo.target, amount);
      await tokenB.approve(swapeo.target, amount);
      await swapeo.deposit(tokenB.target, tokenA.target, amount, amount);
      const lpTokenB_A = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenB.target, tokenA.target));
  
      expect(lpTokenA_B).to.equal(lpTokenB_A);
    });
  
    it("reverts if approved amount is less than deposited amount", async function () {
      const amount = ethers.parseEther("10");
      await tokenA.approve(swapeo.target, amount - 1n);
      await tokenB.approve(swapeo.target, amount);
  
      await expect(
        swapeo.deposit(tokenA.target, tokenB.target, amount, amount)
      ).to.be.revertedWithCustomError(tokenA, "ERC20InsufficientAllowance");
    });
  
    it("handles very large values without overflow or arithmetic error", async function () {
      const largeAmount = ethers.parseUnits("1000000000", 18);
    
      await tokenA.mint(ownerAddress, largeAmount);
      await tokenB.mint(ownerAddress, largeAmount);
    
      await tokenA.approve(swapeo.target, largeAmount);
      await tokenB.approve(swapeo.target, largeAmount);
    
      await expect(
        swapeo.deposit(tokenA.target, tokenB.target, largeAmount, largeAmount)
      ).to.not.be.revertedWith("overflow");
    });
    
    it("reverts for large values only due to insufficient balance, not overflow", async function () {
      const largeAmount = ethers.parseUnits("1000000000", 18);
      await tokenA.approve(swapeo.target, largeAmount);
      await tokenB.approve(swapeo.target, largeAmount);
    
      await expect(
        swapeo.deposit(tokenA.target, tokenB.target, largeAmount, largeAmount)
      ).to.be.revertedWithCustomError(tokenA, "ERC20InsufficientBalance");
    });
  
    it("reverts if deposit is called with non-standard ERC20", async function () {
      const NonStandardERC20 = await ethers.getContractFactory("MockNonStandardERC20");
      const brokenToken = await NonStandardERC20.deploy("Broken Token", "BROKE", 18);
  
      await brokenToken.mint(ownerAddress, ethers.parseEther("10"));
      await brokenToken.approve(swapeo.target, ethers.parseEther("10"));
  
      await tokenB.approve(swapeo.target, ethers.parseEther("10"));
  
      await expect(
        swapeo.deposit(brokenToken.target, tokenB.target, ethers.parseEther("10"), ethers.parseEther("10"))
      ).to.be.reverted; 
    });
  
    it("handles tokens with different decimals correctly", async function () {
      const MockToken6 = await ethers.getContractFactory("MockERC20Decimals");
      const token6 = await MockToken6.deploy("USD Coin", "USDC", 6);
      await token6.mint(ownerAddress, 1_000_000_000);
  
      await token6.approve(swapeo.target, 1_000_000_000);
      await tokenA.approve(swapeo.target, ethers.parseEther("10"));
  
      await expect(
        swapeo.deposit(token6.target, tokenA.target, 1_000_000_000, ethers.parseEther("10"))
      ).to.emit(swapeo, "Deposit");
    });
  });
  
  describe("Fuzzing", function () {
    it("accepts multiple reasonable deposits without reverting", async function () {
      const baseA = ethers.parseEther("10");
      const baseB = ethers.parseEther("20");
      await tokenA.approve(swapeo.target, baseA);
      await tokenB.approve(swapeo.target, baseB);
      await swapeo.deposit(tokenA.target, tokenB.target, baseA, baseB);
  
      for (let i = 1; i <= 10; i++) {
        const factor = Math.floor(Math.random() * 10) + 1;
        const amountA = ethers.parseEther((10 * factor).toString());
        const amountB = ethers.parseEther((20 * factor).toString());
  
        await tokenA.approve(swapeo.target, amountA);
        await tokenB.approve(swapeo.target, amountB);
  
        await expect(
          swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB)
        ).to.not.be.reverted;
      }
    });
  });
  
});
