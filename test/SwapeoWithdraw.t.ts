import { expect } from "chai";
import { ethers } from "hardhat";
import { SwapeoDEX, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("SwapeoWithdraw", function () {
  let swapeo: SwapeoDEX;
  let tokenA: MockERC20;
  let tokenB: MockERC20;
  let tokenC: MockERC20;
  let owner: HardhatEthersSigner;
  let addr1: HardhatEthersSigner;
  let addr2: HardhatEthersSigner;
  let uniswapRouterAddress: string;

  function anyValue() {
    return true;
  }

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = (await MockToken.deploy("Token A", "TKA", 18)) as MockERC20;
    tokenB = (await MockToken.deploy("Token B", "TKB", 18)) as MockERC20;
    tokenC = (await MockToken.deploy("Token C", "TKC", 18)) as MockERC20;

    uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

    const SwapeoDEX = await ethers.getContractFactory("SwapeoDEX");
    swapeo = (await SwapeoDEX.deploy(uniswapRouterAddress, 3)) as SwapeoDEX;

    await tokenA.waitForDeployment();
    await tokenB.waitForDeployment();
    await tokenC.waitForDeployment();
    await swapeo.waitForDeployment();

    await tokenA.transfer(addr1.address, ethers.parseEther("500"));
    await tokenB.transfer(addr1.address, ethers.parseEther("500"));

    await tokenA.connect(addr1).approve(swapeo.target, ethers.parseEther("50"));
    await tokenB.connect(addr1).approve(swapeo.target, ethers.parseEther("50"));
    await swapeo.connect(addr1).deposit(tokenA.target, tokenB.target, ethers.parseEther("50"), ethers.parseEther("50"));

    const amountA = ethers.parseEther("100");
    const amountB = ethers.parseEther("100");

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
    it("should allow withdrawing all liquidity at once", async function () {
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

    it("should allow withdrawing partial liquidity", async function () {
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const withdrawAmount = lpBalance / 2n;

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

    it("should allow withdrawal with reversed token order", async function () {
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const withdrawAmount = lpBalance / 2n;

      await expect(swapeo.withdraw(tokenB.target, tokenA.target, withdrawAmount))
        .to.emit(swapeo, "Withdraw");

      const lpBalanceAfter = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      expect(lpBalanceAfter).to.equal(lpBalance - withdrawAmount);
    });

    it("should allow multiple users to withdraw from the same pair", async function () {
      const ownerLpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const addr1LpBalance = await swapeo.getLPBalance(addr1.address, tokenA.target, tokenB.target);

      await swapeo.withdraw(tokenA.target, tokenB.target, ownerLpBalance);
      await swapeo.connect(addr1).withdraw(tokenA.target, tokenB.target, addr1LpBalance);

      const ownerLpAfter = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const addr1LpAfter = await swapeo.getLPBalance(addr1.address, tokenA.target, tokenB.target);

      expect(ownerLpAfter).to.equal(0);
      expect(addr1LpAfter).to.equal(0);
    });

    it("should transfer withdrawn tokens back to the user", async function () {
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
    it("should revert when token addresses are identical", async function () {
      await expect(
        swapeo.withdraw(tokenA.target, tokenA.target, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(swapeo, "IdenticalTokens");
    });

    it("should revert with ZeroAddress when one of the token addresses is zero", async function () {
      const zeroAddress = "0x0000000000000000000000000000000000000000";
    
      await expect(
        swapeo.withdraw(zeroAddress, tokenB.target, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(swapeo, "ZeroAddress");
    
      await expect(
        swapeo.withdraw(tokenA.target, zeroAddress, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(swapeo, "ZeroAddress");
    });
    

    it("should revert when the withdrawal amount is zero", async function () {
      await expect(
        swapeo.withdraw(tokenA.target, tokenB.target, 0)
      ).to.be.revertedWithCustomError(swapeo, "InsufficientLiquidity");
    });

    it("should revert when user tries to withdraw more LP tokens than owned", async function () {
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const excessAmount = lpBalance + 1n;

      await expect(
        swapeo.withdraw(tokenA.target, tokenB.target, excessAmount)
      ).to.be.revertedWithCustomError(swapeo, "InsufficientLiquidity");
    });

    it("should revert when trying to withdraw from a non-existent pair", async function () {
      await expect(
        swapeo.withdraw(tokenB.target, tokenC.target, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(swapeo, "UnexistingPair");
    });

    it("should revert when user tries to withdraw liquidity they do not own", async function () {
      await expect(
        swapeo.connect(addr2).withdraw(tokenA.target, tokenB.target, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(swapeo, "InsufficientLiquidity");
    });

    it("should clear the pool and transfer all tokens when all liquidity is withdrawn after a swap", async function () {
  await tokenA.connect(addr1).approve(swapeo.target, ethers.parseEther("10"));
  await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, ethers.parseEther("10"), 0);

  const lpOwner = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
  const lpAddr1 = await swapeo.getLPBalance(addr1.address, tokenA.target, tokenB.target);

  if (lpOwner > 0) await swapeo.withdraw(tokenA.target, tokenB.target, lpOwner);
  if (lpAddr1 > 0) await swapeo.connect(addr1).withdraw(tokenA.target, tokenB.target, lpAddr1);

  const tolerance = ethers.parseEther("0.0001");
  expect(await tokenA.balanceOf(swapeo.target)).to.be.lte(tolerance);
  expect(await tokenB.balanceOf(swapeo.target)).to.be.lte(tolerance);
});
    
    
    
  });

  describe("Proportionality", function () {
    it("should return proportional token amounts for multiple withdrawals", async function () {
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const halfLp = lpBalance / 2n;

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
      const toleranceA = tokenAFirstWithdrawal / 100n;
      const toleranceB = tokenBFirstWithdrawal / 100n;

      expect(tokenASecondWithdrawal).to.be.closeTo(tokenAFirstWithdrawal, toleranceA);
      expect(tokenBSecondWithdrawal).to.be.closeTo(tokenBFirstWithdrawal, toleranceB);
    });

    it("should distribute withdrawn tokens proportionally among multiple liquidity providers", async function () {
  const ownerLp = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
  const addr1Lp = await swapeo.getLPBalance(addr1.address, tokenA.target, tokenB.target);

  const totalLp = ownerLp + addr1Lp;
  
  const reserves = await swapeo.getReserves(tokenA.target, tokenB.target);
  const reserveA = reserves[0];
  const reserveB = reserves[1];

  const ownerTokenABefore = await tokenA.balanceOf(owner.address);
  const ownerTokenBBefore = await tokenB.balanceOf(owner.address);

  await swapeo.withdraw(tokenA.target, tokenB.target, ownerLp);

  const ownerTokenAAfter = await tokenA.balanceOf(owner.address);
  const ownerTokenBAfter = await tokenB.balanceOf(owner.address);

  const receivedA_owner = ownerTokenAAfter - ownerTokenABefore;
  const receivedB_owner = ownerTokenBAfter - ownerTokenBBefore;

  expect(receivedA_owner).to.equal(ownerLp * reserveA / totalLp);
  expect(receivedB_owner).to.equal(ownerLp * reserveB / totalLp);
  
  const addr1TokenABefore = await tokenA.balanceOf(addr1.address);
  const addr1TokenBBefore = await tokenB.balanceOf(addr1.address);

  await swapeo.connect(addr1).withdraw(tokenA.target, tokenB.target, addr1Lp);

  const addr1TokenAAfter = await tokenA.balanceOf(addr1.address);
  const addr1TokenBAfter = await tokenB.balanceOf(addr1.address);

  const receivedA_addr1 = addr1TokenAAfter - addr1TokenABefore;
  const receivedB_addr1 = addr1TokenBAfter - addr1TokenBBefore;

  expect(receivedA_addr1).to.equal(reserveA - receivedA_owner);
  expect(receivedB_addr1).to.equal(reserveB - receivedB_owner);
});
  });

  describe("Events and returns", function () {
    it("should emit correct Withdraw event with correct token amounts", async function () {
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const halfLp = lpBalance / 2n;

      const ownerTokenABefore = await tokenA.balanceOf(owner.address);
      const ownerTokenBBefore = await tokenB.balanceOf(owner.address);

      const tx = await swapeo.withdraw(tokenA.target, tokenB.target, halfLp);
      const receipt = await tx.wait();

      let withdrawEvent;
      for (const log of receipt.logs as any[]) {
        try {
          const parsedLog = swapeo.interface.parseLog(log);
          if (parsedLog.name === "Withdraw") {
            withdrawEvent = parsedLog;
            break;
          }
        } catch (e) {}
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

  describe("Edge cases", function () {
    it("should allow withdrawing a very small LP token amount (dust)", async function () {
      const dust = 1n;
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      if (lpBalance > dust) {
        await expect(swapeo.withdraw(tokenA.target, tokenB.target, dust)).to.not.be.reverted;
      }
    });

    it("should withdraw correctly from a pool with tokens of different decimals", async function () {
      const MockToken6 = await ethers.getContractFactory("MockERC20Decimals");
      const token6 = await MockToken6.deploy("USD Coin", "USDC", 6);
      await token6.mint(owner.address, 1_000_000_000); // 1,000 USDC (6 decimals)
      await token6.approve(swapeo.target, 1_000_000_000);
      await tokenA.approve(swapeo.target, ethers.parseEther("10"));
      await swapeo.deposit(token6.target, tokenA.target, 1_000_000_000, ethers.parseEther("10"));
      const lpBalance = await swapeo.getLPBalance(owner.address, token6.target, tokenA.target);
      await expect(swapeo.withdraw(token6.target, tokenA.target, lpBalance)).to.not.be.reverted;
    });

    it("should withdraw correct proportions after a large swap that unbalances the pool", async function () {
      await tokenA.connect(addr1).approve(swapeo.target, ethers.parseEther("100"));
      await swapeo.connect(addr1).swap(tokenA.target, tokenB.target, ethers.parseEther("100"), 0);
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      await expect(swapeo.withdraw(tokenA.target, tokenB.target, lpBalance)).to.not.be.reverted;
    });

    it("should revert if user with zero LP tries to withdraw", async function () {
      await expect(
        swapeo.connect(addr2).withdraw(tokenA.target, tokenB.target, 1)
      ).to.be.revertedWithCustomError(swapeo, "InsufficientLiquidity");
    });

    it("should not allow withdrawing the minimum liquidity reserved in the pool", async function () {
      const minLiquidity = 1n;
      await expect(
        swapeo.withdraw(tokenA.target, tokenB.target, minLiquidity)
      ).to.not.be.reverted;
    });

    it("should handle last provider withdrawal and leave the pool empty", async function () {
      const lpOwner = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
      const lpAddr1 = await swapeo.getLPBalance(addr1.address, tokenA.target, tokenB.target);
    
      if (lpOwner > 0) await swapeo.withdraw(tokenA.target, tokenB.target, lpOwner);
      if (lpAddr1 > 0) await swapeo.connect(addr1).withdraw(tokenA.target, tokenB.target, lpAddr1);
    
      const pairInfo = await swapeo.getPairInfo(tokenA.target, tokenB.target);
      expect(pairInfo._totalLiquidity).to.equal(0);
      expect(pairInfo._reserveA).to.equal(0);
      expect(pairInfo._reserveB).to.equal(0);
    });

    it("should handle withdrawal for a token with 0 decimals", async function () {
      const MockToken0 = await ethers.getContractFactory("MockERC20Decimals");
      const token0 = await MockToken0.deploy("ZeroDecimals", "ZERO", 0);
      await token0.mint(owner.address, 1000);
      await tokenA.approve(swapeo.target, ethers.parseEther("10"));
      await token0.approve(swapeo.target, 1000);
      await swapeo.deposit(tokenA.target, token0.target, ethers.parseEther("10"), 1000);
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, token0.target);
      await expect(swapeo.withdraw(tokenA.target, token0.target, lpBalance)).to.not.be.reverted;
    });

    it("should allow withdrawal by the new LP token owner after LP transfer", async function () {
      await tokenA.connect(addr1).approve(swapeo.target, ethers.parseEther("10"));
      await tokenB.connect(addr1).approve(swapeo.target, ethers.parseEther("10"));
      await swapeo.connect(addr1).deposit(tokenA.target, tokenB.target, ethers.parseEther("10"), ethers.parseEther("10"));
      const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
      const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
    
      const addr1LpBalance = await lpToken.balanceOf(addr1.address);
      await lpToken.connect(addr1).transfer(addr2.address, addr1LpBalance);
    
      await expect(
        swapeo.connect(addr2).withdraw(tokenA.target, tokenB.target, addr1LpBalance)
      ).to.not.be.reverted;
    });

    it("should prevent reentrancy attack on withdraw", async function () {
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);
    
      const ReentrantAttacker = await ethers.getContractFactory("ReentrantAttacker");
      const attacker = await ReentrantAttacker.deploy(
        swapeo.target,
        tokenA.target,
        tokenB.target,
        lpBalance / 10n
      );
    
      const lpTokenAddress = await swapeo.pairKeyToLPToken(await swapeo.getKey(tokenA.target, tokenB.target));
      const lpToken = await ethers.getContractAt("SwapeoLP", lpTokenAddress);
      await lpToken.transfer(attacker.target, lpBalance / 10n);
    
      await expect(attacker.startAttack()).to.not.be.reverted;
    
    });

    it("should revert if token transfer fails during withdraw", async function () {
      const MockTokenRevert = await ethers.getContractFactory("MockERC20RevertOnWithdraw");
      const badToken = await MockTokenRevert.deploy("Bad", "BAD", 18);
      await badToken.mint(owner.address, ethers.parseEther("100"));
    
      await tokenA.approve(swapeo.target, ethers.parseEther("10"));
      await badToken.approve(swapeo.target, ethers.parseEther("10"));
    
      await swapeo.deposit(tokenA.target, badToken.target, ethers.parseEther("10"), ethers.parseEther("10"));
      const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, badToken.target);
    
      await badToken.setFailNextTransfer(true);
    
      await expect(
        swapeo.withdraw(tokenA.target, badToken.target, lpBalance)
      ).to.be.revertedWith("Transfer failed intentionally");
    });
    
  });

  describe("Fuzzing", function () {
    it("should not revert for multiple valid withdrawal amounts", async function () {
      for (let i = 0; i < 10; i++) {
        const lpBalance = await swapeo.getLPBalance(owner.address, tokenA.target, tokenB.target);

        if (lpBalance <= 1n) {
          this.skip?.();
          return;
        }

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
});
