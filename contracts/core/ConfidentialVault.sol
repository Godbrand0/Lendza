// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {ConfidentialCollateral} from "../tokens/ConfidentialCollateral.sol";
import {ConfidentialDebt} from "../tokens/ConfidentialDebt.sol";

/// @title ConfidentialVault
/// @notice Core lending vault for ARGEN × ZAMA.
///
///  ┌─ Borrower flow ────────────────────────────────────────────────────────┐
///  │  1. borrow(encAmount, proof) + msg.value (ETH collateral)              │
///  │     → mints cETH (collateral token) to borrower                       │
///  │     → mints cUSDC (debt token) to borrower                            │
///  │  2. repay(encAmount, proof)                                            │
///  │     → burns cUSDC debt, releases ETH collateral                       │
///  └────────────────────────────────────────────────────────────────────────┘
///
///  ┌─ Lender flow ──────────────────────────────────────────────────────────┐
///  │  depositLiquidity(encAmount, proof) — supply cUSDC to the pool        │
///  └────────────────────────────────────────────────────────────────────────┘
///
///  ┌─ Health factor (on-chain FHE, no Circom) ──────────────────────────────┐
///  │  unhealthy = (collateral_gwei × price × 100) < (debt_usdc × 150_000)  │
///  │                                                                        │
///  │  Scaling rationale (avoids euint64 overflow):                          │
///  │    collateral_gwei × price_int × 100  max ≈ 1.8e17  ✓                 │
///  │    debt_usdc × 150_000                max ≈ 1.8e17  ✓                 │
///  │                                                                        │
///  │  price_int = Chainlink 8-dec price / 1e8  (e.g. 3000 for $3,000)      │
///  └────────────────────────────────────────────────────────────────────────┘
///
///  ┌─ Liquidation ──────────────────────────────────────────────────────────┐
///  │  1. Monitor agent calls requestLiquidationCheck(borrower)              │
///  │     → FHE health check computed on-chain                               │
///  │     → FHE.makePubliclyDecryptable(isUnhealthy) emits handle            │
///  │  2. Zama relayer calls resolveHealthCheck(borrower, result, proof)     │
///  │     → if unhealthy: DutchAuction.startAuction() triggered             │
///  │     → trigger agent earns TRIGGER_FEE_BPS of collateral ETH            │
///  └────────────────────────────────────────────────────────────────────────┘
///
/// @dev Security note: tx.origin is used only for trigger-fee attribution,
///      NOT for access control. This is intentional per the README.
contract ConfidentialVault is ZamaEthereumConfig {
    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Zama relayer address on Sepolia that calls resolveHealthCheck().
    ///         Source: https://docs.zama.org/protocol — DECRYPTION_ADDRESS.
    address public constant DECRYPTION_ADDRESS = 0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478;

    /// @notice LTV threshold constant. Position is unhealthy when
    ///         collateralValue * 100 < debtValue * LIQUIDATION_THRESHOLD.
    uint64 public constant LIQUIDATION_THRESHOLD = 150_000;

    /// @notice Multiplier applied to collateral side of health check.
    uint64 public constant HEALTH_MULTIPLIER = 100;

    /// @notice Trigger agent receives 1% of collateral ETH as a fee.
    uint256 public constant TRIGGER_FEE_BPS = 100; // 1%

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    address public owner;
    IPriceOracle public oracle;
    ConfidentialCollateral public cETH;
    ConfidentialDebt public cUSDC;
    address public auctionContract;

    /// @dev Tracks all borrowers that have opened a position.
    address[] private _activePositions;
    mapping(address => bool) private _isActive;

    /// @dev ETH deposited as collateral per borrower (plaintext gwei for ETH accounting).
    mapping(address => uint256) public collateralGwei;

    /// @dev Pending health-check ebool handles, awaiting relayer decryption.
    mapping(address => ebool) private _pendingHealthCheck;

    /// @dev Tracks whether a health-check is currently pending for a borrower.
    ///      Separate bool required because `delete` cannot be applied to ebool.
    mapping(address => bool) private _hasPendingCheck;

    /// @dev Agent address that triggered a given health check (for fee attribution).
    mapping(address => address) private _triggerAgent;

    /// @dev Lender liquidity balances (encrypted USDC).
    mapping(address => euint64) private _lenderBalance;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event Borrowed(address indexed borrower);
    event Repaid(address indexed borrower);
    event LiquidityDeposited(address indexed lender);
    event LiquidationCheckRequested(address indexed borrower, ebool isUnhealthy);
    event HealthCheckResolved(address indexed borrower, bool isUnhealthy);
    event LiquidationStarted(address indexed borrower);
    event AgentAccessGranted(address indexed account, address indexed agent);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error OnlyOwner();
    error OnlyAuction();
    error OnlyDecryptor();
    error NoCollateral();
    error NoPendingCheck();
    error AlreadyPendingCheck();
    error PositionActive();
    error ZeroCollateral();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    modifier onlyDecryptor() {
        if (msg.sender != DECRYPTION_ADDRESS) revert OnlyDecryptor();
        _;
    }

    constructor(address _oracle, address _cETH, address _cUSDC) {
        owner = msg.sender;
        oracle = IPriceOracle(_oracle);
        cETH = ConfidentialCollateral(_cETH);
        cUSDC = ConfidentialDebt(_cUSDC);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    function setAuctionContract(address _auction) external {
        if (msg.sender != owner) revert OnlyOwner();
        auctionContract = _auction;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Borrower: open / close position
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Open a leveraged position: deposit ETH as collateral, borrow encrypted USDC.
    /// @param encBorrowAmount  Client-side FHE-encrypted borrow amount (USDC 6-dec units).
    /// @param inputProof       Proof generated by fhevmjs alongside the ciphertext.
    function borrow(externalEuint64 encBorrowAmount, bytes calldata inputProof) external payable {
        if (msg.value == 0) revert ZeroCollateral();
        if (_isActive[msg.sender]) revert PositionActive();

        // Validate and decrypt the borrow amount inside the coprocessor.
        euint64 borrowAmount = FHE.fromExternal(encBorrowAmount, inputProof);

        // Record plaintext ETH collateral for auction / withdrawal accounting.
        uint256 gweiDeposited = msg.value / 1 gwei;
        collateralGwei[msg.sender] = gweiDeposited;

        // Mint cETH to borrower: encrypt the plaintext gwei amount.
        euint64 encCollateral = FHE.asEuint64(uint64(gweiDeposited));
        FHE.allowTransient(encCollateral, address(cETH));
        cETH.mint(msg.sender, encCollateral);

        // Mint cUSDC debt to borrower.
        FHE.allowTransient(borrowAmount, address(cUSDC));
        cUSDC.mint(msg.sender, borrowAmount);

        // Track position.
        _isActive[msg.sender] = true;
        _activePositions.push(msg.sender);

        emit Borrowed(msg.sender);
    }

    /// @notice Repay encrypted debt and reclaim ETH collateral.
    /// @param encRepayAmount  Encrypted USDC amount to repay.
    /// @param inputProof      Proof from fhevmjs.
    function repay(externalEuint64 encRepayAmount, bytes calldata inputProof) external {
        if (!_isActive[msg.sender]) revert NoCollateral();

        euint64 repayAmount = FHE.fromExternal(encRepayAmount, inputProof);

        // Burn debt.
        FHE.allowTransient(repayAmount, address(cUSDC));
        cUSDC.burn(msg.sender, repayAmount);

        // Burn collateral token and release ETH.
        euint64 encCollateral = FHE.asEuint64(uint64(collateralGwei[msg.sender]));
        FHE.allowTransient(encCollateral, address(cETH));
        cETH.burn(msg.sender, encCollateral);

        uint256 ethToReturn = collateralGwei[msg.sender] * 1 gwei;
        collateralGwei[msg.sender] = 0;
        _isActive[msg.sender] = false;
        _removePosition(msg.sender);

        (bool ok, ) = msg.sender.call{value: ethToReturn}("");
        require(ok, "ETH transfer failed");

        emit Repaid(msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lender: deposit liquidity
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Lender supplies encrypted USDC to the pool.
    function depositLiquidity(externalEuint64 encAmount, bytes calldata inputProof) external {
        euint64 amount = FHE.fromExternal(encAmount, inputProof);

        if (FHE.isInitialized(_lenderBalance[msg.sender])) {
            _lenderBalance[msg.sender] = FHE.add(_lenderBalance[msg.sender], amount);
        } else {
            _lenderBalance[msg.sender] = amount;
        }

        FHE.allowThis(_lenderBalance[msg.sender]);
        FHE.allow(_lenderBalance[msg.sender], msg.sender);

        emit LiquidityDeposited(msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Liquidation: health check
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Monitor agent calls this to submit a position for FHE health evaluation.
    ///         The result is an encrypted boolean handed to the Zama relayer for decryption.
    /// @dev tx.origin captures the EOA that paid gas — used only for fee attribution.
    function requestLiquidationCheck(address borrower) external {
        if (!_isActive[borrower]) revert NoCollateral();
        if (_hasPendingCheck[borrower]) revert AlreadyPendingCheck();

        uint64 price = oracle.getEthUsdPrice(); // plain integer, e.g. 3000

        // Retrieve encrypted handles owned by this contract.
        euint64 encCollateral = cETH.confidentialBalanceOf(borrower);
        euint64 encDebt = cUSDC.confidentialBalanceOf(borrower);

        // Health formula:
        //   unhealthy = (collateral_gwei × price × 100) < (debt_usdc × 150_000)
        euint64 collateralValue = FHE.mul(encCollateral, FHE.asEuint64(price * HEALTH_MULTIPLIER));
        euint64 debtThreshold = FHE.mul(encDebt, FHE.asEuint64(LIQUIDATION_THRESHOLD));
        ebool isUnhealthy = FHE.lt(collateralValue, debtThreshold);

        // Persist handle so resolveHealthCheck() can verify the proof.
        _pendingHealthCheck[borrower] = isUnhealthy;
        _hasPendingCheck[borrower] = true;
        FHE.allowThis(isUnhealthy);

        // Hand handle to the Zama relayer for public decryption.
        FHE.makePubliclyDecryptable(isUnhealthy);

        // Store trigger agent for fee payment on successful liquidation.
        _triggerAgent[borrower] = tx.origin;

        emit LiquidationCheckRequested(borrower, isUnhealthy);
    }

    /// @notice Called by the Zama relayer once the Gateway has decrypted the health check.
    /// @param borrower             The position being checked.
    /// @param abiEncodedClearResult  ABI-encoded bool from the Gateway.
    /// @param decryptionProof      Signature proof from KMS verifier.
    function resolveHealthCheck(
        address borrower,
        bytes calldata abiEncodedClearResult,
        bytes calldata decryptionProof
    ) external onlyDecryptor {
        ebool pendingCheck = _pendingHealthCheck[borrower];
        if (!_hasPendingCheck[borrower]) revert NoPendingCheck();

        // Verify the decryption proof against the stored handle.
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(pendingCheck);
        FHE.checkSignatures(cts, abiEncodedClearResult, decryptionProof);

        bool isUnhealthy = abi.decode(abiEncodedClearResult, (bool));

        // Clear the pending check.
        _hasPendingCheck[borrower] = false;

        emit HealthCheckResolved(borrower, isUnhealthy);

        if (isUnhealthy) {
            _triggerLiquidation(borrower);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Liquidation: settlement (called back by DutchAuction)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice DutchAuction calls this when a bid is settled to close the position.
    /// @param borrower  Position being liquidated.
    /// @param bidder    Winning bidder — receives collateral.
    /// @param ethPaid   ETH (in wei) received from the bidder.
    function settleLiquidation(address borrower, address bidder, uint256 ethPaid) external {
        if (msg.sender != auctionContract) revert OnlyAuction();

        uint256 collateralEth = collateralGwei[borrower] * 1 gwei;

        // Pay trigger fee (1%) to the agent that flagged the position.
        uint256 triggerFee = (collateralEth * TRIGGER_FEE_BPS) / 10_000;
        address triggerAgent = _triggerAgent[borrower];

        // Wipe debt and burn collateral token.
        cUSDC.wipe(borrower);
        euint64 encCollateral = FHE.asEuint64(uint64(collateralGwei[borrower]));
        FHE.allowTransient(encCollateral, address(cETH));
        cETH.burn(borrower, encCollateral);

        // Close position.
        collateralGwei[borrower] = 0;
        _isActive[borrower] = false;
        _removePosition(borrower);
        delete _triggerAgent[borrower];

        // Transfer trigger fee.
        if (triggerFee > 0 && triggerAgent != address(0)) {
            (bool ok, ) = triggerAgent.call{value: triggerFee}("");
            require(ok, "Trigger fee transfer failed");
        }

        // Remaining ETH (ethPaid) stays in vault to cover lenders.
        // Production: distribute ethPaid to lenders pro-rata.
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Access control: x402 server grants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice x402 server calls this after receiving payment to give `agent` read
    ///         access to `account`'s encrypted position handles.
    function grantAgentAccess(address account, address agent) external {
        if (msg.sender != owner) revert OnlyOwner();
        cETH.grantReadAccess(account, agent);
        cUSDC.grantReadAccess(account, agent);
        emit AgentAccessGranted(account, agent);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns all addresses with active borrow positions.
    ///         Amounts remain encrypted — only addresses are revealed.
    function getActivePositions() external view returns (address[] memory) {
        return _activePositions;
    }

    /// @notice Returns the raw encrypted handles for a position.
    ///         Caller must hold FHE.allow grants to reencrypt them.
    function getPositionHandles(address borrower)
        external
        view
        returns (euint64 encCollateral, euint64 encDebt)
    {
        encCollateral = cETH.confidentialBalanceOf(borrower);
        encDebt = cUSDC.confidentialBalanceOf(borrower);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    function _triggerLiquidation(address borrower) internal {
        require(auctionContract != address(0), "Auction not set");
        emit LiquidationStarted(borrower);
        IDutchAuction(auctionContract).startAuction(borrower, collateralGwei[borrower]);
    }

    function _removePosition(address borrower) internal {
        uint256 len = _activePositions.length;
        for (uint256 i = 0; i < len; i++) {
            if (_activePositions[i] == borrower) {
                _activePositions[i] = _activePositions[len - 1];
                _activePositions.pop();
                break;
            }
        }
    }

    receive() external payable {}
}

/// @dev Minimal interface used by ConfidentialVault to trigger auctions.
interface IDutchAuction {
    function startAuction(address borrower, uint256 collateralGwei) external;
}
