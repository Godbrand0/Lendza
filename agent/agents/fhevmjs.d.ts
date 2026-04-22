declare module "fhevmjs" {
  export function initFhevm(): Promise<void>;
  export function createInstance(opts: Record<string, unknown>): Promise<FhevmInstance>;
  export interface FhevmInstance {
    createEncryptedInput(contractAddress: string, callerAddress: string): EncryptedInput;
    generateKeypair(): { publicKey: string; privateKey: string };
    createEIP712(publicKey: string, contractAddresses: string[], startTimestamp: number, durationDays: number): Record<string, unknown>;
    userDecrypt(
      handles: Array<{ handle: string; contractAddress: string }>,
      privateKey: string,
      publicKey: string,
      signature: string,
      contractAddresses: string[],
      account: string,
      startTimestamp: number,
      durationDays: number,
    ): Promise<Record<string, bigint>>;
  }
  export interface EncryptedInput {
    add64(value: bigint): EncryptedInput;
    encrypt(): Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>;
  }
}
