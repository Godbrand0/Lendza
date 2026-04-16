import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  rainbowWallet,
  coinbaseWallet,
  walletConnectWallet
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { sepolia } from "viem/chains";

// Zama Protocol runs ON Ethereum Sepolia (chain 11155111).
// It is not a separate chain — it is a coprocessor layer on top of Sepolia.
// See: https://docs.zama.ai/protocol/protocol/overview
export { sepolia as zamaSepolia };

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet],
    },
  ],
  {
    appName: "ARGEN × ZAMA",
    projectId: "YOUR_PROJECT_ID",
  }
);

export const config = createConfig({
  connectors,
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(),
  },
  ssr: true,
});
