import { ethers } from "hardhat";
import { expect } from "chai";

describe("Mainnet Fork Sanity Check", function () {
  it("peut lire le solde d'un vrai compte ETH", async function () {
    // Vitalik's wallet (public) :
    const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const balance = await ethers.provider.getBalance(vitalik);
    console.log("Vitalik balance (ETH):", ethers.formatEther(balance));
    expect(balance).to.be.gt(0);
  });

  it("peut impersonate un whale USDC et transférer du USDC", async function () {
    // Ex whale USDC : https://etherscan.io/token/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48#balances
    const whale = "0x55fe002aeff02f77364de339a1292923a15844b8";
    const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

    // 1. Impersonate
    await ethers.provider.send("hardhat_impersonateAccount", [whale]);
    const whaleSigner = await ethers.getSigner(whale);

    // 2. Read USDC balance
    const usdc = await ethers.getContractAt("IERC20", usdcAddress);
    const whaleBalance = await usdc.balanceOf(whale);
    console.log("USDC whale balance:", whaleBalance.toString());
    expect(whaleBalance).to.be.gt(0);

    // 3. Transfère du USDC vers un compte local
    const [deployer] = await ethers.getSigners();
    const tx = await usdc.connect(whaleSigner).transfer(deployer.address, 1_000_000); // 1 USDC = 1e6
    await tx.wait();

    const newBalance = await usdc.balanceOf(deployer.address);
    console.log("Ton nouveau solde USDC:", newBalance.toString());
    expect(newBalance).to.be.gte(1_000_000);

    // 4. Stop impersonate (optionnel mais propre)
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [whale]);
  });
});
