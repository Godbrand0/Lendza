// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @dev Minimal Chainlink AggregatorV3 surface — avoids the @chainlink/contracts dependency.
interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    function decimals() external view returns (uint8);
}

/// @title PriceOracle
/// @notice Wraps a Chainlink ETH/USD feed and exposes a plain integer USD price
///         suitable for use in euint64 FHE arithmetic inside ConfidentialVault.
///
///         Chainlink returns price with 8 decimals (e.g. 300000000000 = $3,000).
///         We strip the 8 decimals: getEthUsdPrice() returns 3000.
///         Maximum supported price: ~1.8e10 USD (euint64 ceiling).
contract PriceOracle is IPriceOracle {
    IAggregatorV3 public immutable feed;

    /// @dev Prices older than this are rejected as stale.
    uint256 public constant STALENESS_THRESHOLD = 3600; // 1 hour

    error StalePrice(uint256 updatedAt, uint256 threshold);
    error NegativePrice(int256 answer);

    constructor(address _feed) {
        feed = IAggregatorV3(_feed);
    }

    /// @inheritdoc IPriceOracle
    function getEthUsdPrice() external view override returns (uint64) {
        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();

        if (block.timestamp - updatedAt > STALENESS_THRESHOLD) {
            revert StalePrice(updatedAt, block.timestamp - STALENESS_THRESHOLD);
        }
        if (answer <= 0) revert NegativePrice(answer);

        // Strip 8 Chainlink decimals → plain integer USD (e.g. 3000 for $3,000).
        return uint64(uint256(answer) / 1e8);
    }
}
