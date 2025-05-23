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
    it("test_deposit_createsNewPair_emitsDepositEvent", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");

      await tokenA.approve(await swapeo.getAddress(), amountA);
      await tokenB.approve(await swapeo.getAddress(), amountB);

      await expect(
        swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB)
      )
        .to.emit(swapeo, "Deposit")
        .withArgs(ownerAddress, await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB, anyValue);

      const lpBalance = await swapeo.getLPBalance(ownerAddress, await tokenA.getAddress(), await tokenB.getAddress());
      expect(lpBalance).to.be.gt(0);
    });

    it("test_deposit_allowsMultipleDeposits_samePair", async function () {
      const amountA1 = ethers.parseEther("10");
      const amountB1 = ethers.parseEther("10");
      const amountA2 = ethers.parseEther("5");
      const amountB2 = ethers.parseEther("5");

      await tokenA.approve(await swapeo.getAddress(), amountA1 + amountA2);
      await tokenB.approve(await swapeo.getAddress(), amountB1 + amountB2);

      await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA1, amountB1);
      const lpBalanceBefore = await swapeo.getLPBalance(ownerAddress, await tokenA.getAddress(), await tokenB.getAddress());

      await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA2, amountB2);
      const lpBalanceAfter = await swapeo.getLPBalance(ownerAddress, await tokenA.getAddress(), await tokenB.getAddress());

      expect(lpBalanceAfter).to.be.gt(lpBalanceBefore);
    });

    it("test_deposit_allowsDifferentUsers_toAddLiquidity", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");

      await tokenA.approve(await swapeo.getAddress(), amountA);
      await tokenB.approve(await swapeo.getAddress(), amountB);
      await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB);

      await tokenA.connect(addr1).approve(await swapeo.getAddress(), amountA);
      await tokenB.connect(addr1).approve(await swapeo.getAddress(), amountB);
      await swapeo.connect(addr1).deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB);

      const lpBalanceOwner = await swapeo.getLPBalance(ownerAddress, await tokenA.getAddress(), await tokenB.getAddress());
      const lpBalanceAddr1 = await swapeo.getLPBalance(addr1Address, await tokenA.getAddress(), await tokenB.getAddress());

      expect(lpBalanceOwner).to.be.gt(0);
      expect(lpBalanceAddr1).to.be.gt(0);
    });

    it("test_deposit_transfersTokens_toContractCorrectly", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");

      const ownerBalanceABefore = await tokenA.balanceOf(ownerAddress);
      const ownerBalanceBBefore = await tokenB.balanceOf(ownerAddress);
      const contractBalanceABefore = await tokenA.balanceOf(await swapeo.getAddress());
      const contractBalanceBBefore = await tokenB.balanceOf(await swapeo.getAddress());

      await tokenA.approve(await swapeo.getAddress(), amountA);
      await tokenB.approve(await swapeo.getAddress(), amountB);
      await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB);

      const ownerBalanceAAfter = await tokenA.balanceOf(ownerAddress);
      const ownerBalanceBAfter = await tokenB.balanceOf(ownerAddress);
      const contractBalanceAAfter = await tokenA.balanceOf(await swapeo.getAddress());
      const contractBalanceBAfter = await tokenB.balanceOf(await swapeo.getAddress());

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
        swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), 0, 0)
      ).to.be.revertedWithCustomError(swapeo, "InsufficientAmounts");
    });

    it("test_deposit_revertsIfBalanceTooLow", async function () {
      const largeAmount = ethers.parseEther("10000");
      await tokenA.connect(addr2).approve(await swapeo.getAddress(), largeAmount);
      await tokenB.connect(addr2).approve(await swapeo.getAddress(), largeAmount);

      await expect(
        swapeo.connect(addr2).deposit(await tokenA.getAddress(), await tokenB.getAddress(), largeAmount, largeAmount)
      ).to.be.revertedWithCustomError(tokenA, "ERC20InsufficientBalance");
    });
  });

  describe("Liquidity calculations", function () {
    it("test_deposit_assignsLpTokens_onFirstDeposit", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("20");

      await tokenA.approve(await swapeo.getAddress(), amountA);
      await tokenB.approve(await swapeo.getAddress(), amountB);

      await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB);

      const lpBalance = await swapeo.getLPBalance(ownerAddress, await tokenA.getAddress(), await tokenB.getAddress());
      expect(lpBalance).to.be.gt(0);
    });

    it("test_deposit_assignsProportionalLpTokens_onSubsequentDeposit", async function () {
      const amountA1 = ethers.parseEther("100");
      const amountB1 = ethers.parseEther("100");

      await tokenA.approve(await swapeo.getAddress(), amountA1);
      await tokenB.approve(await swapeo.getAddress(), amountB1);
      await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA1, amountB1);

      const lpBalance1 = await swapeo.getLPBalance(ownerAddress, await tokenA.getAddress(), await tokenB.getAddress());

      const amountA2 = ethers.parseEther("50");
      const amountB2 = ethers.parseEther("50");

      await tokenA.approve(await swapeo.getAddress(), amountA2);
      await tokenB.approve(await swapeo.getAddress(), amountB2);
      await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA2, amountB2);

      const lpBalance2 = await swapeo.getLPBalance(ownerAddress, await tokenA.getAddress(), await tokenB.getAddress());

      const expectedIncrease = lpBalance1 / BigInt(2);
      const actualIncrease = lpBalance2 - lpBalance1;
      const tolerance = expectedIncrease / BigInt(100);

      expect(actualIncrease).to.be.closeTo(expectedIncrease, tolerance);
    });
  });

  describe("Events and returns", function () {
    it("test_deposit_emitsDepositEvent_withCorrectParams", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");

      await tokenA.approve(await swapeo.getAddress(), amountA);
      await tokenB.approve(await swapeo.getAddress(), amountB);

      await expect(
        swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB)
      )
        .to.emit(swapeo, "Deposit")
        .withArgs(ownerAddress, await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB, anyValue);
    });

    it("test_deposit_returnsCorrectLpTokenAmount", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");

      await tokenA.approve(await swapeo.getAddress(), amountA);
      await tokenB.approve(await swapeo.getAddress(), amountB);

      const tx = await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB);
      const receipt = await tx.wait();

      // TypeChain donne accès à l'event directement si besoin
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
      expect(depositEvent!.args[5]).to.not.be.undefined;

      const lpAmount = depositEvent!.args[5];
      const lpBalance = await swapeo.getLPBalance(ownerAddress, await tokenA.getAddress(), await tokenB.getAddress());
      expect(lpBalance).to.equal(lpAmount);
    });

    it("test_deposit_subtractsMinimumLiquidity_onFirstDeposit", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");

      await tokenA.approve(await swapeo.getAddress(), amountA);
      await tokenB.approve(await swapeo.getAddress(), amountB);
      await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB);

      const pairKey = await swapeo.getKey(await tokenA.getAddress(), await tokenB.getAddress());
      const pair = await swapeo.s_pairKeyToPairInfo(pairKey);

      expect(pair.totalLiquidity).to.be.lt(ethers.parseEther("10"));
    });

    it("test_deposit_registersLpProvider_correctly", async function () {
      const amountA = ethers.parseEther("5");
      const amountB = ethers.parseEther("5");

      await tokenA.approve(await swapeo.getAddress(), amountA);
      await tokenB.approve(await swapeo.getAddress(), amountB);
      await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB);

      const providers = await swapeo.getLPProviders(await tokenA.getAddress(), await tokenB.getAddress());
      expect(providers).to.include(ownerAddress);
    });
  });

  describe("Fuzzing", function () {
    it("test_fuzz_deposit_shouldSucceedWithReasonableAmounts", async function () {
      const baseA = ethers.parseEther("10");
      const baseB = ethers.parseEther("20");
      await tokenA.approve(await swapeo.getAddress(), baseA);
      await tokenB.approve(await swapeo.getAddress(), baseB);
      await swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), baseA, baseB);

      for (let i = 1; i <= 10; i++) {
        const factor = Math.floor(Math.random() * 10) + 1;
        const amountA = ethers.parseEther((10 * factor).toString());
        const amountB = ethers.parseEther((20 * factor).toString());

        await tokenA.approve(await swapeo.getAddress(), amountA);
        await tokenB.approve(await swapeo.getAddress(), amountB);

        await expect(
          swapeo.deposit(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB)
        ).to.not.be.reverted;
      }
    });
  });
});
