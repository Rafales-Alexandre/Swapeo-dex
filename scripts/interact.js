// scripts/interact.js
import hardhat from "hardhat";
const { ethers } = hardhat;

async function main() {
  const [owner, user1] = await ethers.getSigners();
  console.log("Connected accounts:");
  console.log("  Owner:", owner.address);
  console.log("  User1:", user1.address, "\n");

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const tokenA    = await MockERC20.deploy("Token A", "TKA", 18);
  await tokenA.waitForDeployment();
  const tokenB    = await MockERC20.deploy("Token B", "TKB", 18);
  await tokenB.waitForDeployment();

  const MockRouter = await ethers.getContractFactory("MockUniswapRouter");
  const router     = await MockRouter.deploy();
  await router.waitForDeployment();
  const tokenAAddr = await tokenA.getAddress();
  const tokenBAddr = await tokenB.getAddress();
  const routerAddr = await router.getAddress();

  await router.setTokens(tokenAAddr, tokenBAddr);

  const SwapeoDEX = await ethers.getContractFactory("SwapeoDEX");
  const swapeo    = await SwapeoDEX.deploy(routerAddr, 3); 
  await swapeo.waitForDeployment();
  const swapeoAddr = await swapeo.getAddress();

  console.log("Deployed addresses:");
  console.log("  tokenA:", tokenAAddr);
  console.log("  tokenB:", tokenBAddr);
  console.log("  router:", routerAddr);
  console.log("  swapeo:", swapeoAddr, "\n");

  async function printBal(label, token, who) {
    const b = await token.balanceOf(who);
    console.log(`  ${label}: ${b}`);
  }

  console.log("=== Initial Balances ===");
  await printBal("Owner TKA", tokenA, owner.address);
  await printBal("Owner TKB", tokenB, owner.address);
  await printBal("User1 TKA", tokenA, user1.address);
  await printBal("User1 TKB", tokenB, user1.address);
  console.log();

  const amt100 = ethers.parseEther("100");
  console.log("Depositing liquidity: 100 A and 100 B from Owner...");
  await tokenA.connect(owner).approve(swapeoAddr, amt100);
  await tokenB.connect(owner).approve(swapeoAddr, amt100);
  await swapeo.connect(owner).deposit(tokenAAddr, tokenBAddr, amt100, amt100);

  let [rA, rB] = await swapeo.getReserves(tokenAAddr, tokenBAddr);
  console.log(`Post-deposit Reserves: ${rA} A | ${rB} B\n`);

  const amt10 = ethers.parseEther("10");
  console.log("User1 swapping 10 A for B via swap()...");
  await tokenA.connect(owner).transfer(user1.address, amt10);
  await tokenA.connect(user1).approve(swapeoAddr, amt10);
  const beforeB = await tokenB.balanceOf(user1.address);
  await swapeo.connect(user1).swap(tokenAAddr, tokenBAddr, amt10, 0);
  const afterB = await tokenB.balanceOf(user1.address);
  console.log(`Swap output (B): ${afterB - beforeB}\n`);

  const sim5   = ethers.parseEther("5");
  const simOut = await swapeo.getAmountOut(sim5, tokenAAddr, tokenBAddr);
  console.log(`Simulated getAmountOut for 5 A: ${simOut} B\n`);

  console.log("Funding router with 5 B for forwardToUniswap...");
  await tokenB.connect(owner).transfer(routerAddr, sim5);
  await tokenA.connect(owner).transfer(user1.address, sim5);
  await tokenA.connect(user1).approve(swapeoAddr, sim5);

  console.log("User1 forwardToUniswap 5 A (fee 0.5% to Owner)...");
  const beforeB2 = await tokenB.balanceOf(user1.address);
  await swapeo
    .connect(user1)
    .forwardToUniswap(tokenAAddr, tokenBAddr, sim5, 0);
  const afterB2 = await tokenB.balanceOf(user1.address);
  console.log(`Forward output (B): ${afterB2 - beforeB2}\n`);

  console.log("Owner TokenA after fee:", await tokenA.balanceOf(owner.address));
  console.log("Owner claiming fees...");
  await swapeo.connect(owner).claimFees(tokenAAddr, tokenBAddr);
  console.log(
    "Owner TokenA after claimFees:",
    await tokenA.balanceOf(owner.address)
  );
  console.log("Owner distributing fees...");
  await swapeo.connect(owner).distributeFees(tokenAAddr, tokenBAddr);
  [rA, rB] = await swapeo.getReserves(tokenAAddr, tokenBAddr);
  console.log(`Post-distribute Reserves: ${rA} A | ${rB} B\n`);

  console.log("Owner withdrawing LP amount: 1...");
  try {
    await swapeo.connect(owner).withdraw(tokenAAddr, tokenBAddr, 1);
    console.log("Withdraw successful.");
  } catch (err) {
    console.log("Withdraw failed:", err);
  }
  console.log("\n=== Interaction script completed ===");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
