// scripts/multiInteract.js
import hardhat from "hardhat";
const { ethers } = hardhat;

async function main() {
  const [owner, provider2, provider3, trader1, trader2] = await ethers.getSigners();
  console.log("Accounts:");
  console.log("  Owner:     ", owner.address);
  console.log("  Provider2: ", provider2.address);
  console.log("  Provider3: ", provider3.address);
  console.log("  Trader1:   ", trader1.address);
  console.log("  Trader2:   ", trader2.address, "\n");

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const tokenA    = await MockERC20.deploy("Token A", "TKA", 18);
  await tokenA.waitForDeployment();
  const tokenB    = await MockERC20.deploy("Token B", "TKB", 18);
  await tokenB.waitForDeployment();

  const tokenAAddr = await tokenA.getAddress();
  const tokenBAddr = await tokenB.getAddress();

  const MockRouter = await ethers.getContractFactory("MockUniswapRouter");
  const router     = await MockRouter.deploy();
  await router.waitForDeployment();
  await router.setTokens(tokenAAddr, tokenBAddr);
  const routerAddr = await router.getAddress();

  const SwapeoDEX = await ethers.getContractFactory("SwapeoDEX");
  const swapeo    = await SwapeoDEX.deploy(routerAddr, 3);
  await swapeo.waitForDeployment();
  const swapeoAddr = await swapeo.getAddress();

  console.log("Deployed:");
  console.log("  tokenA: ", tokenAAddr);
  console.log("  tokenB: ", tokenBAddr);
  console.log("  router: ", routerAddr);
  console.log("  swapeo: ", swapeoAddr, "\n");

  async function showBal(label, token, who) {
    const b = await token.balanceOf(who);
    console.log(`  ${label}: ${b}`);
  }

  const providers = [owner, provider2, provider3];
  const amounts    = ["50", "100", "150"]; 

  console.log("=== Funding Providers ===");
 for (let i = 0; i < providers.length; i++) {
   const prov = providers[i];
   const amt  = ethers.parseEther(amounts[i]);
   await tokenA.connect(owner).transfer(prov.address, amt);
   await tokenB.connect(owner).transfer(prov.address, amt);
   console.log(`  Funded Provider${i+1} (${prov.address}) with ${amounts[i]} A & ${amounts[i]} B`);
 }
 console.log();

  console.log("=== Providers deposit ===");
  for (let i = 0; i < providers.length; i++) {
    const prov = providers[i];
    const amt   = ethers.parseEther(amounts[i]);
    console.log(`\nProvider ${i+1} (${prov.address}) deposits ${amounts[i]} A + ${amounts[i]} B`);
    await tokenA.connect(prov).approve(swapeoAddr, amt);
    await tokenB.connect(prov).approve(swapeoAddr, amt);
    await swapeo.connect(prov).deposit(tokenAAddr, tokenBAddr, amt, amt);

    const lpBal = await swapeo.getLPBalance(prov.address, tokenAAddr, tokenBAddr);
    console.log(`  LP balance: ${lpBal}`);
  }
  let [rA, rB] = await swapeo.getReserves(tokenAAddr, tokenBAddr);
  console.log(`\nReserves after deposits: ${rA} A | ${rB} B\n`);

  console.log("=== Traders internal swap ===");
  const swapIns = [ "10", "20" ];
  const traders = [ trader1, trader2 ];
  for (let i = 0; i < traders.length; i++) {
    const tr    = traders[i];
    const inAmt = ethers.parseEther(swapIns[i]);
    await tokenA.connect(owner).transfer(tr.address, inAmt);
    await tokenA.connect(tr).approve(swapeoAddr, inAmt);

    console.log(`Trader${i+1} swaps ${swapIns[i]} A for B`);
    const before = await tokenB.balanceOf(tr.address);
    await swapeo.connect(tr).swap(tokenAAddr, tokenBAddr, inAmt, 0);
    const after  = await tokenB.balanceOf(tr.address);
    console.log(`  Received B: ${after - before}`);
  }
  [rA, rB] = await swapeo.getReserves(tokenAAddr, tokenBAddr);
  console.log(`\nReserves after swaps: ${rA} A | ${rB} B\n`);

  console.log("=== Traders forwardToUniswap ===");
  const fwdIns = [ "5", "7" ];
  for (let i = 0; i < traders.length; i++) {
    const tr    = traders[i];
    const inAmt = ethers.parseEther(fwdIns[i]);
    await tokenA.connect(owner).transfer(tr.address, inAmt);
    await tokenA.connect(tr).approve(swapeoAddr, inAmt);
    await tokenB.connect(owner).transfer(routerAddr, inAmt);

    console.log(`Trader${i+1} forwards ${fwdIns[i]} A via Uniswap mock`);
    const before = await tokenB.balanceOf(tr.address);
    await swapeo.connect(tr).swap(tokenAAddr, tokenBAddr, inAmt, 0);
    const after  = await tokenB.balanceOf(tr.address);
    console.log(`  Received B: ${after - before}`);
  }
  console.log();

  console.log("=== Owner fees ===");
  await showBal("Owner TKA before claim", tokenA, owner.address);
  await swapeo.connect(owner).claimFees(tokenAAddr, tokenBAddr);
  await showBal("Owner TKA after claim", tokenA, owner.address);

  await swapeo.connect(owner).distributeFees(tokenAAddr, tokenBAddr);
  [rA, rB] = await swapeo.getReserves(tokenAAddr, tokenBAddr);
  console.log(`Reserves after distribute: ${rA} A | ${rB} B\n`);

  console.log("=== Providers withdraw ===");
  for (let i = 0; i < providers.length; i++) {
    const prov = providers[i];
    const lp   = await swapeo.getLPBalance(prov.address, tokenAAddr, tokenBAddr);
    console.log(`Provider${i+1} (${prov.address}) withdraws LP = ${lp}`);
    await swapeo.connect(prov).withdraw(tokenAAddr, tokenBAddr, lp);

    await showBal(`  ${prov.address} TKA`, tokenA, prov.address);
    await showBal(`  ${prov.address} TKB`, tokenB, prov.address);
    console.log();
  }

  console.log("=== Multi-Interaction script completed ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
