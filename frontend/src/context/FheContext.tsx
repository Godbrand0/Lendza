"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";
import { useAccount } from "wagmi";

interface FheContextValue {
  /** The live fhevmInstance — null until wallet is connected */
  instance: FhevmInstance | null;
  /** Connected wallet address */
  account: string | null;
  /** ethers Signer for sending transactions */
  signer: JsonRpcSigner | null;
  /** ethers provider */
  provider: BrowserProvider | null;
  /** True while initSDK() is still loading */
  sdkReady: boolean;
  /** Last connection error */
  error: string | null;
}

const FheContext = createContext<FheContextValue>({
  instance: null,
  account: null,
  signer: null,
  provider: null,
  sdkReady: false,
  error: null,
});

export function FheContextProvider({ children }: { children: React.ReactNode }) {
  const [instance, setInstance] = useState<FhevmInstance | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initStarted = useRef(false);

  // Wagmi hooks
  const { address, isConnected, connector } = useAccount();

  // 1. Initial SDK Setup (WASM Load)
  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;

    initSDK()
      .then(() => setSdkReady(true))
      .catch((e: unknown) => {
        console.error("initSDK failed:", e);
        setError("Failed to load FHE WASM. Please refresh.");
      });
  }, []);

  // 2. Sync FHE Instance & Ethers Signer with Wagmi Client
  useEffect(() => {
    if (!isConnected || !connector || !sdkReady) {
      setInstance(null);
      setSigner(null);
      setProvider(null);
      return;
    }

    const syncFhe = async () => {
      try {
        // Get the EIP-1193 provider from the connector
        const eip1193Provider = await connector.getProvider();
        
        // Build ethers provider/signer
        const web3Provider = new BrowserProvider(eip1193Provider as any);
        const web3Signer = await web3Provider.getSigner();

        // Build the FHE instance
        const config = { ...SepoliaConfig, network: eip1193Provider };
        const fheInstance = await createInstance(config as any);

        setProvider(web3Provider);
        setSigner(web3Signer);
        setInstance(fheInstance);
      } catch (e: unknown) {
        console.error("FHE Sync failed:", e);
        setError("Failed to sync FHE session with wallet.");
      }
    };

    syncFhe();
  }, [isConnected, connector, sdkReady]);

  return (
    <FheContext.Provider
      value={{ 
        instance, 
        account: address || null, 
        signer, 
        provider, 
        sdkReady, 
        error 
      }}
    >
      {children}
    </FheContext.Provider>
  );
}

export function useFhe() {
  return useContext(FheContext);
}
