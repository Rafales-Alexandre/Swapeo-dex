import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("SwapeoModule", (m) => {
  const tokenA = m.contract("MockERC20", ["TokenA", "TKA", 18], { id: "TokenA" });
  const tokenB = m.contract("MockERC20", ["TokenB", "TKB", 18], { id: "TokenB" });
  const router = m.contract("MockUniswapRouter", [], { id: "MockRouter" });

  const swapeo = m.contract("SwapeoDEX", [router, 3], { id: "Swapeo" });

  return { tokenA, tokenB, router, swapeo };
});
