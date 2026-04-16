import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { 
  metaMaskWallet, 
  rainbowWallet, 
  coinbaseWallet, 
  walletConnectWallet 
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { defineChain } from "viem";

// Define the Zama Sepolia Chain
export const zamaSepolia = defineChain({
  id: 8008135,
  name: "Zama Sepolia",
  nativeCurrency: { name: "ZAMA", symbol: "ZAMA", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://api.sepolia.zama.ai"] },
  },
  blockExplorers: {
    default: { name: "Zama Explorer", url: "https://explorer.zama.ai" },
  },
});

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
  chains: [zamaSepolia],
  transports: {
    [zamaSepolia.id]: http(),
  },
  ssr: true,
});
