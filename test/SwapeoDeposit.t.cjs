const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwapeoDeposit", function () {
  let swapeo;
  let tokenA;
  let tokenB;
  let tokenC;
  let owner;
  let addr1;
  let addr2;
  let uniswapRouterAddress;
  
  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    
    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = await MockToken.deploy("Token A", "TKA", 18);
    tokenB = await MockToken.deploy("Token B", "TKB", 18);
    tokenC = await MockToken.deploy("Token C", "TKC", 18);
      
    uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    
    const SwapeoDEX = await ethers.getContractFactory("SwapeoDEX");
    swapeo = await SwapeoDEX.deploy(uniswapRouterAddress, 3);
    
    await tokenA.waitForDeployment();
    await tokenB.waitForDeployment();
    await tokenC.waitForDeployment();
    await swapeo.waitForDeployment();

    
  await tokenA.transfer(addr1.address, ethers.parseEther("500"));
  await tokenB.transfer(addr1.address, ethers.parseEther("500"));
  });

  describe("Happy path", function () {
    it("test_deposit_createsNewPair_emitsDepositEvent", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
      
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      
      await expect(swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB))
        .to.emit(swapeo, "Deposit")
        .withArgs(owner.address, tokenA.target, tokenB.target, amountA, amountB, anyValue);
        
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      expect(lpBalance).to.be.gt(0);
    });
    
    it("test_deposit_allowsMultipleDeposits_samePair", async function () {
      const amountA1 = ethers.parseEther("10");
      const amountB1 = ethers.parseEther("10");
      const amountA2 = ethers.parseEther("5");
      const amountB2 = ethers.parseEther("5");
      
      await tokenA.approve(swapeo.target, amountA1 + amountA2);
      await tokenB.approve(swapeo.target, amountB1 + amountB2);
      
      await swapeo.deposit(tokenA.target, tokenB.target, amountA1, amountB1);
      const lpBalanceBefore = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      
      await swapeo.deposit(tokenA.target, tokenB.target, amountA2, amountB2);
      const lpBalanceAfter = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      
      expect(lpBalanceAfter).to.be.gt(lpBalanceBefore);
    });
    
    it("test_deposit_allowsDifferentUsers_toAddLiquidity", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
      
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
      
      await tokenA.connect(addr1).approve(swapeo.target, amountA);
      await tokenB.connect(addr1).approve(swapeo.target, amountB);
      await swapeo.connect(addr1).deposit(tokenA.target, tokenB.target, amountA, amountB);
      
      const lpBalanceOwner = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const lpBalanceAddr1 = await swapeo.getLPBalance(addr1.address, tokenA.target, tokenB.target);
      
      expect(lpBalanceOwner).to.be.gt(0);
      expect(lpBalanceAddr1).to.be.gt(0);
    });

    it("test_deposit_transfersTokens_toContractCorrectly", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
      
      const ownerBalanceABefore = await tokenA.balanceOf(owner.address);
      const ownerBalanceBBefore = await tokenB.balanceOf(owner.address);
      const contractBalanceABefore = await tokenA.balanceOf(swapeo.target);
      const contractBalanceBBefore = await tokenB.balanceOf(swapeo.target);
      
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
      
      const ownerBalanceAAfter = await tokenA.balanceOf(owner.address);
      const ownerBalanceBAfter = await tokenB.balanceOf(owner.address);
      const contractBalanceAAfter = await tokenA.balanceOf(swapeo.target);
      const contractBalanceBAfter = await tokenB.balanceOf(swapeo.target);
      
      expect(ownerBalanceABefore - ownerBalanceAAfter).to.equal(amountA);
      expect(ownerBalanceBBefore - ownerBalanceBAfter).to.equal(amountB);
      expect(contractBalanceAAfter - contractBalanceABefore).to.equal(amountA);
      expect(contractBalanceBAfter - contractBalanceBBefore).to.equal(amountB);
    });
  });

  describe("Unhappy path", function () {
    it("test_deposit_revertsIfTokenAddressesAreIdentical", async function () {
      const amount = ethers.parseEther("10");

      await tokenA.approve(await swapeo.getAddress(), amount);

      await expect(
        swapeo.deposit(await tokenA.getAddress(), await tokenA.getAddress(), amount, amount)
      ).to.be.revertedWithCustomError(swapeo, "IdenticalTokens");
    });
    
    it("test_deposit_revertsIfZeroAddressUsed", async function () {
      const amount = ethers.parseEther("10");
      const zeroAddress = "0x0000000000000000000000000000000000000000";
      
      await tokenA.approve(await swapeo.getAddress(), amount);
      
      await expect(
        swapeo.deposit(zeroAddress, await tokenA.getAddress(), amount, amount)
      ).to.be.revertedWithCustomError(swapeo, "ZeroAddress");
      
      await expect(
        swapeo.deposit(await tokenA.getAddress(), zeroAddress, amount, amount)
      ).to.be.revertedWithCustomError(swapeo, "ZeroAddress");
    });
    
    it("test_deposit_revertsIfAmountsAreZero", async function () {
      await expect(
        swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), 0, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(swapeo, "InsufficientAmounts");
      
      await expect(
        swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), ethers.parseEther("10"), 0)
      ).to.be.revertedWithCustomError(swapeo, "InsufficientAmounts");
      
      await expect(
        swapeo.deposit(tokenA.target, tokenB.target, 0, 0)
      ).to.be.revertedWithCustomError(swapeo, "InsufficientAmounts");
    });
    
      it("test_deposit_revertsIfBalanceTooLow", async function () {
        const largeAmount = ethers.parseEther("10000");
        await tokenA.connect(addr2).approve(swapeo.target, largeAmount);
        await tokenB.connect(addr2).approve(swapeo.target, largeAmount);
      
        await expect(
            swapeo.connect(addr2).deposit(tokenA.target, tokenB.target, largeAmount, largeAmount)
          ).to.be.revertedWithCustomError(tokenA, "ERC20InsufficientBalance");
          
      });
      
      
      
  });

  describe("Liquidity calculations", function () {
    it("test_deposit_assignsLpTokens_onFirstDeposit", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("20"); 
      
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      
      await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
      
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      
      expect(lpBalance).to.be.gt(0);
    });
    
    it("test_deposit_assignsProportionalLpTokens_onSubsequentDeposit", async function () {
      const amountA1 = ethers.parseEther("100");
      const amountB1 = ethers.parseEther("100");
      
      await tokenA.approve(swapeo.target, amountA1);
      await tokenB.approve(swapeo.target, amountB1);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA1, amountB1);
      
      const lpBalance1 = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      
      const amountA2 = ethers.parseEther("50");
      const amountB2 = ethers.parseEther("50");
      
      await tokenA.approve(swapeo.target, amountA2);
      await tokenB.approve(swapeo.target, amountB2);
      await swapeo.deposit(tokenA.target, tokenB.target, amountA2, amountB2);
      
      const lpBalance2 = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      
      const expectedIncrease = lpBalance1 / BigInt(2);
      const actualIncrease = lpBalance2 - lpBalance1;
      
      const tolerance = expectedIncrease / BigInt(100);
      
      expect(actualIncrease).to.be.closeTo(expectedIncrease, tolerance);
    });
  });
  
  describe("Events and returns", function() {
    it("test_deposit_emitsDepositEvent_withCorrectParams", async function() {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
      
      await tokenA.approve(swapeo.target, amountA);
      await tokenB.approve(swapeo.target, amountB);
      
      await expect(swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB))
        .to.emit(swapeo, "Deposit")
        .withArgs(owner.address, tokenA.target, tokenB.target, amountA, amountB, anyValue);
    });
    
    it("test_deposit_returnsCorrectLpTokenAmount", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
    
      await tokenA.approve(await swapeo.getAddress(), amountA);
      await tokenB.approve(await swapeo.getAddress(), amountB);
    
      const tx = await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB);
      const receipt = await tx.wait();
    
      let depositEvent;
      for (const log of receipt.logs) {
        try {
          const parsed = swapeo.interface.parseLog(log);
          if (parsed && parsed.name === "Deposit") {
            depositEvent = parsed;
            break;
          }
        } catch (error) {
          console.error("Error parsing log:", error);
        }
      }
    
      expect(depositEvent).to.not.be.undefined;
      expect(depositEvent.args).to.not.be.undefined;
      expect(depositEvent.args[5]).to.not.be.undefined;
    
      const lpAmount = depositEvent.args[5];
      const lpBalance = await swapeo.getLPBalance(owner.address, await tokenA.getAddress(), await tokenB.getAddress());
      expect(lpBalance).to.equal(lpAmount);
    });
    
    it("test_deposit_subtractsMinimumLiquidity_onFirstDeposit", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");
    
      await tokenA.approve(await swapeo.getAddress(), amountA);
      await tokenB.approve(await swapeo.getAddress(), amountB);
      await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB);
    
      const pairKey = await swapeo.getKey(await tokenA.getAddress(), await tokenB.getAddress());
      const pair = await swapeo.pairs(pairKey);
    
      expect(pair.totalLiquidity).to.be.lt(ethers.parseEther("10"));
    });
    
  
      it("test_deposit_registersLpProvider_correctly", async function () {
        const amountA = ethers.parseEther("5");
        const amountB = ethers.parseEther("5");
  
        await tokenA.approve(swapeo.target, amountA);
        await tokenB.approve(swapeo.target, amountB);
        await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
  
        const providers = await swapeo.getLPProviders(tokenA.target, tokenB.target);
        expect(providers).to.include(owner.address);
      });
  });

  describe("Fuzzing", function () {
    it("test_fuzz_deposit_shouldSucceedWithReasonableAmounts", async function () {
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
  
  function anyValue() {
    return true;
  }
}); 