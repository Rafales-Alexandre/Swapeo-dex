// scripts/deploy.js
async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying from", await deployer.getAddress());
  
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const tokenA = await MockERC20.deploy("Token A", "TKA", 18);
    await tokenA.waitForDeployment();
    const tokenAAddress = await tokenA.getAddress();
  
    const tokenB = await MockERC20.deploy("Token B", "TKB", 18);
    await tokenB.waitForDeployment();
    const tokenBAddress = await tokenB.getAddress();
  
    const MockRouter = await ethers.getContractFactory("MockUniswapRouter");
    const router = await MockRouter.deploy();
    await router.waitForDeployment();
    const routerAddress = await router.getAddress();
  
    await router.setTokens(tokenAAddress, tokenBAddress);
  
    const SwapeoDEX = await ethers.getContractFactory("SwapeoDEX");
    const swapeo = await SwapeoDEX.deploy(routerAddress, 3);
    await swapeo.waitForDeployment();
    const swapeoAddress = await swapeo.getAddress();
  
    console.log("tokenA:", tokenAAddress);
    console.log("tokenB:", tokenBAddress);
    console.log("router:", routerAddress);
    console.log("swapeo:", swapeoAddress);
  }
  
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
  