const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwapeoWithdraw", function () {
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
    
    const amountA = ethers.parseEther("100");
    const amountB = ethers.parseEther("100");

await tokenA.transfer(addr1.address, ethers.parseEther("500"));
await tokenB.transfer(addr1.address, ethers.parseEther("500"));

await tokenA.connect(addr1).approve(swapeo.target, ethers.parseEther("50"));
await tokenB.connect(addr1).approve(swapeo.target, ethers.parseEther("50"));
await swapeo.connect(addr1).deposit(tokenA.target, tokenB.target, ethers.parseEther("50"), ethers.parseEther("50"));

    
    await tokenA.approve(swapeo.target, amountA);
    await tokenB.approve(swapeo.target, amountB);
    await swapeo.deposit(tokenA.target, tokenB.target, amountA, amountB);
    
    const amountC = ethers.parseEther("100");
    await tokenA.approve(swapeo.target, amountA);
    await tokenC.approve(swapeo.target, amountC);
    await swapeo.deposit(tokenA.target, tokenC.target, amountA, amountC);
    
    await tokenA.connect(addr1).approve(swapeo.target, ethers.parseEther("50"));
    await tokenB.connect(addr1).approve(swapeo.target, ethers.parseEther("50"));
    await swapeo.connect(addr1).deposit(tokenA.target, tokenB.target, ethers.parseEther("50"), ethers.parseEther("50"));


  });

  describe("Happy path", function () {
    it("test_withdraw_allLiquidity_succeeds", async function () {
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      
      const ownerTokenABefore = await tokenA.balanceOf(owner.address);
      const ownerTokenBBefore = await tokenB.balanceOf(owner.address);
      
      await expect(swapeo.withdraw(tokenA.target, tokenB.target, lpBalance))
  .to.emit(swapeo, "Withdraw")
  .withArgs(owner.address, tokenA.target, tokenB.target, anyValue, anyValue);
      
      const lpBalanceAfter = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const ownerTokenAAfter = await tokenA.balanceOf(owner.address);
      const ownerTokenBAfter = await tokenB.balanceOf(owner.address);
      
      expect(lpBalanceAfter).to.equal(0);
      expect(ownerTokenAAfter).to.be.gt(ownerTokenABefore);
      expect(ownerTokenBAfter).to.be.gt(ownerTokenBBefore);
    });
    
    it("test_withdraw_partialLiquidity_succeeds", async function () {
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const withdrawAmount = lpBalance / BigInt(2); 
      
      const ownerTokenABefore = await tokenA.balanceOf(owner.address);
      const ownerTokenBBefore = await tokenB.balanceOf(owner.address);
      
      await swapeo.withdraw(tokenA.target, tokenB.target, withdrawAmount);
      
      const lpBalanceAfter = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const ownerTokenAAfter = await tokenA.balanceOf(owner.address);
      const ownerTokenBAfter = await tokenB.balanceOf(owner.address);
      
      expect(lpBalanceAfter).to.equal(lpBalance - withdrawAmount);
      expect(ownerTokenAAfter).to.be.gt(ownerTokenABefore);
      expect(ownerTokenBAfter).to.be.gt(ownerTokenBBefore);
    });
    
    it("test_withdraw_reversedTokenOrder_succeeds", async function () {
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const withdrawAmount = lpBalance / BigInt(2);
      
      await expect(swapeo.withdraw(tokenB.target, tokenA.target, withdrawAmount))
        .to.emit(swapeo, "Withdraw");
      
      const lpBalanceAfter = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      expect(lpBalanceAfter).to.equal(lpBalance - withdrawAmount);
    });
    
    it("test_withdraw_multipleUsersFromSamePair_succeeds", async function () {
      const ownerLpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const addr1LpBalance = await swapeo.getLPBalance(addr1.address, tokenA.target, tokenB.target);
      
      await swapeo.withdraw(tokenA.target, tokenB.target, ownerLpBalance);
      
      await swapeo.connect(addr1).withdraw(tokenA.target, tokenB.target, addr1LpBalance);
      
      const ownerLpAfter = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const addr1LpAfter = await swapeo.getLPBalance(addr1.address, tokenA.target, tokenB.target);
      
      expect(ownerLpAfter).to.equal(0);
      expect(addr1LpAfter).to.equal(0);
    });

    it("test_withdraw_transfersTokensBackToUser", async function () {
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      
      const ownerTokenABefore = await tokenA.balanceOf(owner.address);
      const ownerTokenBBefore = await tokenB.balanceOf(owner.address);
      const contractTokenABefore = await tokenA.balanceOf(swapeo.target);
      const contractTokenBBefore = await tokenB.balanceOf(swapeo.target);
      
      await swapeo.withdraw(tokenA.target, tokenB.target, lpBalance);
      
      const ownerTokenAAfter = await tokenA.balanceOf(owner.address);
      const ownerTokenBAfter = await tokenB.balanceOf(owner.address);
      const contractTokenAAfter = await tokenA.balanceOf(swapeo.target);
      const contractTokenBAfter = await tokenB.balanceOf(swapeo.target);
      
      const tokenAReceived = ownerTokenAAfter - ownerTokenABefore;
      const tokenBReceived = ownerTokenBAfter - ownerTokenBBefore;
      const contractTokenAReduced = contractTokenABefore - contractTokenAAfter;
      const contractTokenBReduced = contractTokenBBefore - contractTokenBAfter;
      
      expect(tokenAReceived).to.equal(contractTokenAReduced);
      expect(tokenBReceived).to.equal(contractTokenBReduced);
    });
  });

  describe("UnhappyPath", function () {
    it("test_withdraw_revertsOnIdenticalAddresses", async function () {
      await expect(
        swapeo.withdraw(tokenA.target, tokenA.target, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(swapeo, "InsufficientLiquidity");
    });
    
    it("test_withdraw_revertsOnZeroAddress", async function () {
      const zeroAddress = "0x0000000000000000000000000000000000000000";
      
      await expect(
        swapeo.withdraw(zeroAddress, tokenB.target, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(swapeo, "InsufficientLiquidity");
      
      await expect(
        swapeo.withdraw(tokenA.target, zeroAddress, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(swapeo, "InsufficientLiquidity");
    });
    
    it("test_withdraw_revertsOnZeroAmount", async function () {
      await expect(
        swapeo.withdraw(tokenA.target, tokenB.target, 0)
      ).to.be.revertedWithCustomError(swapeo, "InsufficientLiquidity");
    });
    
    it("test_withdraw_revertsOnInsufficientLPBalance", async function () {
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const excessAmount = lpBalance + BigInt(1);
      
      await expect(
        swapeo.withdraw(tokenA.target, tokenB.target, excessAmount)
      ).to.be.revertedWithCustomError(swapeo, "InsufficientLiquidity");
    });
    
    it("test_withdraw_revertsOnNonExistentPair", async function () {
      await expect(
        swapeo.withdraw(tokenB.target, tokenC.target, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(swapeo, "InsufficientLiquidity");
    });
    
    it("test_withdraw_revertsOnUnownedLiquidity", async function () {
      await expect(
        swapeo.connect(addr2).withdraw(tokenA.target, tokenB.target, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(swapeo, "InsufficientLiquidity");
    });
  });

  describe("Proportionality", function () {
    it("test_withdraw_proportionalTokens_forMultipleWithdrawals", async function () {
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const halfLp = lpBalance / BigInt(2);
      
      const ownerTokenABefore = await tokenA.balanceOf(owner.address);
      const ownerTokenBBefore = await tokenB.balanceOf(owner.address);
      
      await swapeo.withdraw(tokenA.target, tokenB.target, halfLp);
      
      const ownerTokenAMid = await tokenA.balanceOf(owner.address);
      const ownerTokenBMid = await tokenB.balanceOf(owner.address);
      
      const tokenAFirstWithdrawal = ownerTokenAMid - ownerTokenABefore;
      const tokenBFirstWithdrawal = ownerTokenBMid - ownerTokenBBefore;
      
      await swapeo.withdraw(tokenA.target, tokenB.target, halfLp);
      
      const ownerTokenAAfter = await tokenA.balanceOf(owner.address);
      const ownerTokenBAfter = await tokenB.balanceOf(owner.address);
      
      const tokenASecondWithdrawal = ownerTokenAAfter - ownerTokenAMid;
      const tokenBSecondWithdrawal = ownerTokenBAfter - ownerTokenBMid;
      const toleranceA = tokenAFirstWithdrawal / BigInt(100);
      const toleranceB = tokenBFirstWithdrawal / BigInt(100);
      
      expect(tokenASecondWithdrawal).to.be.closeTo(tokenAFirstWithdrawal, toleranceA);
      expect(tokenBSecondWithdrawal).to.be.closeTo(tokenBFirstWithdrawal, toleranceB);
    });
    
    it("test_withdraw_proportionalDistributionAmongProviders", async function () {
        const ownerLp = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
        const addr1Lp = await swapeo.getLPBalance(addr1.address, tokenA.target, tokenB.target);
  
        const ownerBalanceABefore = await tokenA.balanceOf(owner.address);
        const ownerBalanceBBefore = await tokenB.balanceOf(owner.address);
        const addr1BalanceABefore = await tokenA.balanceOf(addr1.address);
        const addr1BalanceBBefore = await tokenB.balanceOf(addr1.address);
  
        let pairInfo = await swapeo.getPairInfo(tokenA.target, tokenB.target);
        let reserveA_initial = pairInfo._reserveA;
        let reserveB_initial = pairInfo._reserveB;
        let totalLp_initial = pairInfo._totalLiquidity;
  
        expect(ownerLp).to.be.gt(0);
        expect(addr1Lp).to.be.gt(0);
        expect(totalLp_initial).to.equal(ownerLp + addr1Lp);
  
        const expectedOwnerA = (ownerLp * BigInt(reserveA_initial)) / BigInt(totalLp_initial);
        const expectedOwnerB = (ownerLp * BigInt(reserveB_initial)) / BigInt(totalLp_initial);
  
        await expect(swapeo.withdraw(tokenA.target, tokenB.target, ownerLp))
            .to.emit(swapeo, "Withdraw");
  
        const ownerBalanceAAfterWithdraw1 = await tokenA.balanceOf(owner.address);
        const ownerBalanceBAfterWithdraw1 = await tokenB.balanceOf(owner.address);
        const ownerReceivedA = ownerBalanceAAfterWithdraw1 - ownerBalanceABefore;
        const ownerReceivedB = ownerBalanceBAfterWithdraw1 - ownerBalanceBBefore;
  
        const tolerance = BigInt(100);
        expect(ownerReceivedA).to.be.closeTo(expectedOwnerA, tolerance, "Owner A amount mismatch");
        expect(ownerReceivedB).to.be.closeTo(expectedOwnerB, tolerance, "Owner B amount mismatch");
  
        pairInfo = await swapeo.getPairInfo(tokenA.target, tokenB.target);
        let reserveA_mid = pairInfo._reserveA;
        let reserveB_mid = pairInfo._reserveB;
        let totalLp_mid = pairInfo._totalLiquidity;
  
        expect(totalLp_mid).to.equal(addr1Lp);
  
        const expectedAddr1A = (addr1Lp * BigInt(reserveA_mid)) / BigInt(totalLp_mid);
        const expectedAddr1B = (addr1Lp * BigInt(reserveB_mid)) / BigInt(totalLp_mid);
  
        await expect(swapeo.connect(addr1).withdraw(tokenA.target, tokenB.target, addr1Lp))
          .to.emit(swapeo, "Withdraw");
  
        const addr1BalanceAAfterWithdraw2 = await tokenA.balanceOf(addr1.address);
        const addr1BalanceBAfterWithdraw2 = await tokenB.balanceOf(addr1.address);
        const addr1ReceivedA = addr1BalanceAAfterWithdraw2 - addr1BalanceABefore;
        const addr1ReceivedB = addr1BalanceBAfterWithdraw2 - addr1BalanceBBefore;
  
        expect(addr1ReceivedA).to.be.closeTo(expectedAddr1A, tolerance, "Addr1 A amount mismatch");
        expect(addr1ReceivedB).to.be.closeTo(expectedAddr1B, tolerance, "Addr1 B amount mismatch");
  
        pairInfo = await swapeo.getPairInfo(tokenA.target, tokenB.target);
        expect(pairInfo._totalLiquidity).to.equal(0);
      });
      
  });
  
  describe("Events and returns", function() {
    it("test_withdraw_emitsCorrectEventAmounts", async function () {
        const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
        const halfLp = lpBalance / BigInt(2);
        
        const ownerTokenABefore = await tokenA.balanceOf(owner.address);
        const ownerTokenBBefore = await tokenB.balanceOf(owner.address);
        
        const tx = await swapeo.withdraw(tokenA.target, tokenB.target, halfLp);
        const receipt = await tx.wait();
        
        let withdrawEvent;
        for (const log of receipt.logs) {
          try {
            const parsedLog = swapeo.interface.parseLog(log);
            if (parsedLog.name === "Withdraw") {
              withdrawEvent = parsedLog;
              break;
            }
          } catch (e) {
          }
        }
        expect(withdrawEvent).to.not.be.undefined;
        
        const amountA = withdrawEvent.args[3]; 
        const amountB = withdrawEvent.args[4];
        
        const ownerTokenAAfter = await tokenA.balanceOf(owner.address);
        const ownerTokenBAfter = await tokenB.balanceOf(owner.address);
        
        const actualAmountA = ownerTokenAAfter - ownerTokenABefore;
        const actualAmountB = ownerTokenBAfter - ownerTokenBBefore;
        
        expect(actualAmountA).to.equal(amountA);
        expect(actualAmountB).to.equal(amountB);
      });
      
  });
  describe("Fuzzing", function () {
    it("test_fuzz_withdraw_shouldNotRevertWithValidInputs", async function () {
      for (let i = 0; i < 10; i++) {
        const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
  
        if (lpBalance <= 1n) return this.skip(); 
  
        const percent = BigInt(Math.floor(Math.random() * 100) + 1);
        let fuzzAmount = (lpBalance * percent) / 100n;
  
        fuzzAmount = fuzzAmount < 1n ? 1n : fuzzAmount > lpBalance ? lpBalance : fuzzAmount;
  
        const beforeA = await tokenA.balanceOf(owner.address);
        const beforeB = await tokenB.balanceOf(owner.address);
  
        await expect(
          swapeo.withdraw(tokenA.target, tokenB.target, fuzzAmount)
        ).to.not.be.reverted;
  
        const afterA = await tokenA.balanceOf(owner.address);
        const afterB = await tokenB.balanceOf(owner.address);
  
        expect(afterA).to.be.gte(beforeA);
        expect(afterB).to.be.gte(beforeB);
      }
    });
  });
  
  
  
  function anyValue() {
    return true;
  }
}); 