// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ConfidentialCollateral (cETH)
/// @notice ERC-7984-style confidential token representing locked ETH collateral.
///         Balances are stored as euint64 in gwei units (1 ETH = 1e9 gwei).
///         Only the Vault may mint or burn; holders may transfer between themselves.
///
/// @dev FHE access model:
///      - allowThis  → contract retains handle for future arithmetic
///      - allow(to)  → recipient can reencrypt their own balance
///      - allow(vault) → Vault can read balances for health-factor computation
///
///      When the Vault passes an encrypted handle into mint()/burn(), it MUST call
///      FHE.allowTransient(handle, address(this)) in the same transaction before
///      invoking these functions.
contract ConfidentialCollateral is ZamaEthereumConfig {
    string public constant name = "Confidential ETH";
    string public constant symbol = "cETH";

    address public immutable vault;

    mapping(address account => euint64 balance) private _balances;

    event ConfidentialMint(address indexed to);
    event ConfidentialBurn(address indexed from);
    event ConfidentialTransfer(address indexed from, address indexed to);

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

    /// @notice Returns the encrypted balance handle for `account`.
    ///         Caller must hold an FHE.allow grant to reencrypt the result.
    function confidentialBalanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vault-only
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Mint `amount` gwei of cETH to `to`. Called by Vault on deposit.
    /// @dev Vault must call FHE.allowTransient(amount, address(this)) first.
    function mint(address to, euint64 amount) external onlyVault {
        if (FHE.isInitialized(_balances[to])) {
            _balances[to] = FHE.add(_balances[to], amount);
        } else {
            _balances[to] = amount;
        }
        _refreshAccess(to);
        emit ConfidentialMint(to);
    }

    /// @notice Burn `amount` gwei of cETH from `from`. Called by Vault on withdrawal or liquidation.
    /// @dev Vault must call FHE.allowTransient(amount, address(this)) first.
    function burn(address from, euint64 amount) external onlyVault {
        if (!FHE.isInitialized(_balances[from])) revert NoBalance();
        _balances[from] = FHE.sub(_balances[from], amount);
        _refreshAccess(from);
        emit ConfidentialBurn(from);
    }

    /// @notice Grant an additional address read access to `account`'s balance handle.
    ///         Used by the x402 server to sell FHE read grants to agents.
    function grantReadAccess(address account, address reader) external onlyVault {
        FHE.allow(_balances[account], reader);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // User transfers
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Transfer `amount` from caller to `to`.
    ///         Used by the DutchAuction contract to deliver collateral to the winning bidder.
    /// @dev Caller must hold FHE.allow on `amount`.
    function confidentialTransfer(address to, euint64 amount) external {
        if (!FHE.isInitialized(_balances[msg.sender])) revert NoBalance();
        _balances[msg.sender] = FHE.sub(_balances[msg.sender], amount);
        if (FHE.isInitialized(_balances[to])) {
            _balances[to] = FHE.add(_balances[to], amount);
        } else {
            _balances[to] = amount;
        }
        _refreshAccess(msg.sender);
        _refreshAccess(to);
        emit ConfidentialTransfer(msg.sender, to);
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
