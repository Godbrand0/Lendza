import { initFhevm, createInstance, FhevmInstance } from "fhevmjs";
import { ethers } from "ethers";

let instance: FhevmInstance | null = null;

export async function getFhevmInstance(provider: ethers.Provider): Promise<FhevmInstance> {
  if (instance) return instance;

  await initFhevm();
  
  // Fetch common FHEVM info from the provider if needed, or use known defaults for Sepolia/Local
  const network = await provider.getNetwork();
  
  // For Zama's FHEVM, we usually need the public key and other params
  // On Sepolia, we fetch these from the Gateway/Contract
  // For this implementation, we'll assume a standard setup
  
  instance = await createInstance({
    chainId: Number(network.chainId),
    //@ts-ignore
    publicKey: await provider.call({ to: "0x000000000000000000000000000000000000005d", data: "0xd9438255" }), // Standard Zama publicKey selector
  });

  return instance;
}
