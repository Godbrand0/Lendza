// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockPriceFeed
/// @notice A minimal Chainlink AggregatorV3-compatible mock for local/test deployments.
/// @dev Set the answer with setAnswer() before running tests.
contract MockPriceFeed {
    int256 private _answer;
    uint8 private constant _DECIMALS = 8;
    uint256 private _updatedAt;

    error StalePrice();

    constructor(int256 initialAnswer) {
        _answer = initialAnswer;
        _updatedAt = block.timestamp;
    }

    /// @notice Update the mock price (owner-free — tests call this directly).
    function setAnswer(int256 newAnswer) external {
        _answer = newAnswer;
        _updatedAt = block.timestamp;
    }

    /// @notice Matches AggregatorV3Interface.latestRoundData().
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, _answer, _updatedAt, _updatedAt, 1);
    }

    function decimals() external pure returns (uint8) {
        return _DECIMALS;
    }
}
