// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPriceOracle
/// @notice Interface for querying the current ETH/USD price used by the Vault.
interface IPriceOracle {
    /// @notice Returns the current ETH price in whole USD (Chainlink 8-decimal feed stripped).
    /// @return price ETH/USD as a plain integer (e.g. 3000 for $3,000)
    function getEthUsdPrice() external view returns (uint64);
}
