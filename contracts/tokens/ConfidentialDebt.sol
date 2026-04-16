// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ConfidentialDebt (cUSDC)
/// @notice ERC-7984-style confidential token representing outstanding debt.
///         Balances are stored as euint64 in 6-decimal USDC units (1 USDC = 1e6).
///         Only the Vault may mint (on borrow) or burn (on repay / liquidation).
///
/// @dev Same FHE access model as ConfidentialCollateral:
///      allowThis + allow(borrower) + allow(vault)
///
///      Vault MUST call FHE.allowTransient(amount, address(this)) before mint/burn.
contract ConfidentialDebt is ZamaEthereumConfig {
    string public constant name = "Confidential USDC Debt";
    string public constant symbol = "cUSDC";

    address public immutable vault;

    mapping(address account => euint64 balance) private _balances;

    event ConfidentialMint(address indexed to);
    event ConfidentialBurn(address indexed from);

    error OnlyVault();
    error NoBalance();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(address _vault) {
        vault = _vault;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the encrypted debt handle for `account`.
    function confidentialBalanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vault-only
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Mint debt to `to` when they borrow. Vault must allowTransient first.
    function mint(address to, euint64 amount) external onlyVault {
        if (FHE.isInitialized(_balances[to])) {
            _balances[to] = FHE.add(_balances[to], amount);
        } else {
            _balances[to] = amount;
        }
        _refreshAccess(to);
        emit ConfidentialMint(to);
    }

    /// @notice Burn debt from `from` when they repay or are liquidated. Vault must allowTransient first.
    function burn(address from, euint64 amount) external onlyVault {
        if (!FHE.isInitialized(_balances[from])) revert NoBalance();
        _balances[from] = FHE.sub(_balances[from], amount);
        _refreshAccess(from);
        emit ConfidentialBurn(from);
    }

    /// @notice Zero out all debt for `account` after a full liquidation.
    function wipe(address account) external onlyVault {
        _balances[account] = FHE.asEuint64(0);
        _refreshAccess(account);
    }

    /// @notice Grant read access on a borrower's debt handle to an external agent.
    function grantReadAccess(address account, address reader) external onlyVault {
        FHE.allow(_balances[account], reader);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    function _refreshAccess(address account) internal {
        FHE.allowThis(_balances[account]);
        FHE.allow(_balances[account], account);
        FHE.allow(_balances[account], vault);
    }
}
