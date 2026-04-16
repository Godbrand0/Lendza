import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    // Required for @zama-fhe/relayer-sdk WASM modules (TFHE, TKMS)
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        // Fix for MetaMask SDK / Wagmi peer dependencies
        "@react-native-async-storage/async-storage": false,
        "pino-pretty": false,
        "lokijs": false,
        "encoding": false,
      };
    }

    return config;
  },
};

export default nextConfig;
