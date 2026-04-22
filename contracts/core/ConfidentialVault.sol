// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

import {ConfidentialCollateral} from "../tokens/ConfidentialCollateral.sol";
import {ConfidentialDebt} from "../tokens/ConfidentialDebt.sol";

/// @title ConfidentialVault
///
///  Privacy model
///  ─────────────
///  Amounts are stored in two parallel tracks:
///
///  1. FHE-encrypted (euint64)
///     • cUSDC token   — borrower's debt, used for health checks & balance reveal
///     • cETH token    — collateral receipt, used for health checks
///     • _lenderBalance — lender's deposit, used for balance reveal
///     Only the holder can decrypt these via Zama KMS userDecrypt.
///
///  2. Private plaintext (uint256 private)
///     • _borrowPrincipal — used internally for USDC routing & interest math
///     • _lenderPrincipal — used internally for USDC routing & interest math
///     No public getter exists. Not readable via normal contract calls.
///     (raw eth_getStorageAt can still reach them — true calldata privacy
///     requires confidential ERC-20 which is out of scope here.)
///
///  Aggregate pool metrics (totalLenderDeposits, totalInterestAccrued) are
///  public — they reveal pool size but not individual balances.
///
///  ┌─ Borrower flow ────────────────────────────────────────────────────────┐
///  │  1. depositCollateral() + msg.value                                    │
///  │  2. borrow(encAmount, proof, amountPlain, durationMinutes)             │
///  │     → mints cETH receipt, mints cUSDC debt, sends real USDC           │
///  │  3. repay()  ← approve vault for totalDue first                       │
///  │     → pulls USDC (principal + interest), releases ETH                 │
///  └────────────────────────────────────────────────────────────────────────┘
///
///  ┌─ Lender flow ──────────────────────────────────────────────────────────┐
///  │  1. depositLiquidity(encAmount, proof, amountPlain) ← approve first   │
///  │  2. withdrawLiquidity(amount)                                          │
///  │     pass type(uint256).max to withdraw everything without             │
///  │     revealing your balance in calldata                                 │
///  └────────────────────────────────────────────────────────────────────────┘
contract ConfidentialVault is ZamaEthereumConfig {

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    address public constant DECRYPTION_ADDRESS = 0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478;

    uint64  public constant LIQUIDATION_THRESHOLD  = 150_000;
    uint64  public constant HEALTH_MULTIPLIER      = 100;
    uint256 public constant TRIGGER_FEE_BPS        = 100;
    uint256 public constant INTEREST_BPS_PER_MINUTE = 100;
    uint64  public constant ETH_PRICE_USD          = 3000;

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    address public owner;
    ConfidentialCollateral public cETH;
    ConfidentialDebt public cUSDC;
    IERC20 public mockUsdc;
    address public auctionContract;

    // ── Position tracking ────────────────────────────────────────────────────

    address[] private _activePositions;
    mapping(address => bool) private _isActive;
    mapping(address => bool) public hasCollateral;

    /// @dev Plaintext ETH collateral — needed for msg.value math. ETH txs are
    ///      inherently public so storing this as plaintext is acceptable.
    mapping(address => uint256) public collateralGwei;

    /// @dev Private plaintext principal — NEVER exposed via a public getter.
    ///      Used only inside repay() for USDC routing and interest computation.
    mapping(address => uint256) private _borrowPrincipal;

    mapping(address => uint256) public loanStartTime;
    mapping(address => uint256) public loanTermSeconds;

    // ── Liquidation ──────────────────────────────────────────────────────────

    mapping(address => ebool)   private _pendingHealthCheck;
    mapping(address => bool)    private _hasPendingCheck;
    mapping(address => address) private _triggerAgent;

    // ── Lender ───────────────────────────────────────────────────────────────

    /// @dev FHE-encrypted lender balance — for privacy reveal UI only.
    mapping(address => euint64) private _lenderBalance;

    /// @dev Private plaintext deposit — NEVER exposed via a public getter.
    ///      Used only inside withdrawLiquidity() for USDC routing.
    mapping(address => uint256) private _lenderPrincipal;

    address[] private _lenderAddresses;
    mapping(address => bool) public isLender;

    // ── Pool accounting ──────────────────────────────────────────────────────

    uint256 public totalCollateralGwei;
    uint256 public protocolEthEarnings;

    /// @dev Sum of all active lender deposits (for pro-rata interest splits).
    uint256 public totalLenderDeposits;

    /// @dev Accumulated interest from repayments not yet withdrawn by lenders.
    uint256 public totalInterestAccrued;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event CollateralDeposited(address indexed borrower, uint256 gweiAmount);
    event CollateralWithdrawn(address indexed borrower, uint256 gweiAmount);
    event Borrowed(address indexed borrower);
    event Repaid(address indexed borrower);
    event LiquidityDeposited(address indexed lender);
    event LiquidityWithdrawn(address indexed lender);
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
    error ActiveDebt();
    error ZeroCollateral();
    error InvalidDuration();
    error LoanOverdue();
    error InsufficientPoolLiquidity();
    error NoLenderDeposit();
    error ZeroAmount();
    error ExceedsAvailableBalance();

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    modifier onlyDecryptor() {
        if (msg.sender != DECRYPTION_ADDRESS) revert OnlyDecryptor();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address _cETH, address _cUSDC, address _mockUsdc) {
        owner = msg.sender;
        cETH  = ConfidentialCollateral(_cETH);
        cUSDC = ConfidentialDebt(_cUSDC);
        mockUsdc = IERC20(_mockUsdc);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    function setAuctionContract(address _auction) external {
        if (msg.sender != owner) revert OnlyOwner();
        auctionContract = _auction;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Borrower: collateral
    // ─────────────────────────────────────────────────────────────────────────

    function depositCollateral() external payable {
        if (msg.value == 0) revert ZeroCollateral();

        uint256 gwei_ = msg.value / 1 gwei;
        collateralGwei[msg.sender] += gwei_;
        hasCollateral[msg.sender] = true;
        totalCollateralGwei += gwei_;

        euint64 enc = FHE.asEuint64(uint64(gwei_));
        FHE.allowTransient(enc, address(cETH));
        cETH.mint(msg.sender, enc);

        emit CollateralDeposited(msg.sender, gwei_);
    }

    function withdrawCollateral() external {
        if (!hasCollateral[msg.sender]) revert NoCollateral();
        if (_isActive[msg.sender]) revert ActiveDebt();

        uint256 gwei_ = collateralGwei[msg.sender];

        euint64 enc = FHE.asEuint64(uint64(gwei_));
        FHE.allowTransient(enc, address(cETH));
        cETH.burn(msg.sender, enc);

        totalCollateralGwei -= gwei_;
        collateralGwei[msg.sender] = 0;
        hasCollateral[msg.sender] = false;

        (bool ok,) = msg.sender.call{value: gwei_ * 1 gwei}("");
        require(ok, "ETH transfer failed");

        emit CollateralWithdrawn(msg.sender, gwei_);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Borrower: borrow / repay
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Borrow mock USDC against deposited ETH collateral.
    /// @param encBorrowAmount  FHE-encrypted borrow amount (stored in cUSDC for
    ///                         health checks and balance reveal).
    /// @param inputProof       Proof from fhevmjs.
    /// @param borrowAmountPlain Plaintext amount used to transfer real USDC.
    ///                         Visible in calldata but NOT stored in any public
    ///                         mapping — state privacy is preserved.
    /// @param durationMinutes  Loan term (1–1440 min).
    function borrow(
        externalEuint64 encBorrowAmount,
        bytes calldata inputProof,
        uint256 borrowAmountPlain,
        uint256 durationMinutes
    ) external {
        if (!hasCollateral[msg.sender]) revert NoCollateral();
        if (_isActive[msg.sender]) revert PositionActive();
        if (durationMinutes == 0 || durationMinutes > 1440) revert InvalidDuration();
        if (borrowAmountPlain == 0) revert ZeroAmount();
        if (mockUsdc.balanceOf(address(this)) < borrowAmountPlain) revert InsufficientPoolLiquidity();

        // Store plaintext principal privately — used only in repay().
        _borrowPrincipal[msg.sender] = borrowAmountPlain;

        loanStartTime[msg.sender]  = block.timestamp;
        loanTermSeconds[msg.sender] = durationMinutes * 60;

        // Mint FHE-encrypted cUSDC for health checks and balance reveals.
        euint64 encAmt = FHE.fromExternal(encBorrowAmount, inputProof);
        FHE.allowTransient(encAmt, address(cUSDC));
        cUSDC.mint(msg.sender, encAmt);

        _isActive[msg.sender] = true;
        _activePositions.push(msg.sender);

        // Transfer real USDC from pool to borrower.
        mockUsdc.transfer(msg.sender, borrowAmountPlain);

        emit Borrowed(msg.sender);
    }

    /// @notice Repay debt and reclaim ETH collateral.
    ///         The exact repayment amount is computed on-chain from the private
    ///         principal + accrued interest. Caller must first approve this
    ///         contract for at least that amount on the mock USDC token.
    ///         Call getMyTotalDue() with your connected wallet to get the figure.
    function repay() external {
        if (!_isActive[msg.sender]) revert NoCollateral();

        uint256 dueTime = loanStartTime[msg.sender] + loanTermSeconds[msg.sender];
        if (block.timestamp > dueTime) revert LoanOverdue();

        uint256 principal = _borrowPrincipal[msg.sender];
        uint256 elapsed   = (block.timestamp - loanStartTime[msg.sender]) / 60;
        uint256 interest  = (principal * INTEREST_BPS_PER_MINUTE * elapsed) / 10_000;
        uint256 totalDue  = principal + interest;

        // Pull repayment — borrower must have approved vault for totalDue.
        mockUsdc.transferFrom(msg.sender, address(this), totalDue);

        // Route interest to lender pool.
        totalInterestAccrued += interest;

        // Wipe encrypted debt (health check state cleanup).
        cUSDC.wipe(msg.sender);

        // Burn cETH receipt and release ETH.
        euint64 encColl = FHE.asEuint64(uint64(collateralGwei[msg.sender]));
        FHE.allowTransient(encColl, address(cETH));
        cETH.burn(msg.sender, encColl);

        uint256 ethToReturn = collateralGwei[msg.sender] * 1 gwei;
        totalCollateralGwei          -= collateralGwei[msg.sender];
        collateralGwei[msg.sender]    = 0;
        _borrowPrincipal[msg.sender]  = 0;
        _isActive[msg.sender]         = false;
        hasCollateral[msg.sender]     = false;
        _removePosition(msg.sender);

        (bool ok,) = msg.sender.call{value: ethToReturn}("");
        require(ok, "ETH transfer failed");

        emit Repaid(msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lender: deposit / withdraw
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Supply mock USDC to the lending pool.
    ///         Caller must first approve this contract for `amountPlain` USDC.
    /// @param encAmount   FHE-encrypted amount (stored for balance reveal UI).
    /// @param inputProof  Proof from fhevmjs.
    /// @param amountPlain Plaintext amount for the actual transferFrom.
    ///                    Visible in calldata but NOT in any public mapping.
    function depositLiquidity(
        externalEuint64 encAmount,
        bytes calldata inputProof,
        uint256 amountPlain
    ) external {
        if (amountPlain == 0) revert ZeroAmount();

        // Pull real USDC into the vault.
        mockUsdc.transferFrom(msg.sender, address(this), amountPlain);

        // Track privately for pro-rata interest distribution.
        _lenderPrincipal[msg.sender] += amountPlain;
        totalLenderDeposits += amountPlain;

        // Mint FHE-encrypted balance for the reveal UI.
        euint64 encAmt = FHE.fromExternal(encAmount, inputProof);
        if (FHE.isInitialized(_lenderBalance[msg.sender])) {
            _lenderBalance[msg.sender] = FHE.add(_lenderBalance[msg.sender], encAmt);
        } else {
            _lenderBalance[msg.sender] = encAmt;
            if (!isLender[msg.sender]) {
                isLender[msg.sender] = true;
                _lenderAddresses.push(msg.sender);
            }
        }
        FHE.allowThis(_lenderBalance[msg.sender]);
        FHE.allow(_lenderBalance[msg.sender], msg.sender);

        emit LiquidityDeposited(msg.sender);
    }

    /// @notice Withdraw deposited USDC plus pro-rata accrued interest.
    ///
    ///         Pass `type(uint256).max` to withdraw everything — this reveals
    ///         nothing about your balance in calldata.
    ///
    ///         Pass a specific amount for a partial withdrawal (the amount will
    ///         be visible in calldata — a conscious privacy trade-off).
    ///
    ///         Payout is split proportionally between principal and interest so
    ///         partial withdrawals are fair across both buckets.
    function withdrawLiquidity(uint256 amount) external {
        uint256 deposit = _lenderPrincipal[msg.sender];
        if (deposit == 0) revert NoLenderDeposit();

        uint256 interestShare = totalLenderDeposits > 0
            ? (deposit * totalInterestAccrued) / totalLenderDeposits
            : 0;
        uint256 maxPayout = deposit + interestShare;

        // Sentinel: type(uint256).max means "withdraw everything".
        uint256 payout = (amount == type(uint256).max) ? maxPayout : amount;
        if (payout > maxPayout) revert ExceedsAvailableBalance();
        if (mockUsdc.balanceOf(address(this)) < payout) revert InsufficientPoolLiquidity();

        if (payout == maxPayout) {
            // ── Full withdrawal ──────────────────────────────────────────────
            totalLenderDeposits -= deposit;
            totalInterestAccrued = interestShare <= totalInterestAccrued
                ? totalInterestAccrued - interestShare : 0;
            _lenderPrincipal[msg.sender] = 0;

            // Zero out the encrypted balance.
            _lenderBalance[msg.sender] = FHE.asEuint64(0);
        } else {
            // ── Partial withdrawal ───────────────────────────────────────────
            // Split payout proportionally: principalOut / interestOut = deposit / interestShare
            uint256 principalOut = maxPayout > 0 ? (payout * deposit) / maxPayout : payout;
            uint256 interestOut  = payout - principalOut;

            totalLenderDeposits          -= principalOut;
            totalInterestAccrued          = interestOut <= totalInterestAccrued
                ? totalInterestAccrued - interestOut : 0;
            _lenderPrincipal[msg.sender] -= principalOut;

            // Reduce encrypted balance by principalOut so reveal stays accurate.
            euint64 encOut = FHE.asEuint64(uint64(principalOut));
            _lenderBalance[msg.sender] = FHE.sub(_lenderBalance[msg.sender], encOut);
        }

        FHE.allowThis(_lenderBalance[msg.sender]);
        FHE.allow(_lenderBalance[msg.sender], msg.sender);

        mockUsdc.transfer(msg.sender, payout);

        emit LiquidityWithdrawn(msg.sender);
    }

    function getLenderBalanceHandle(address account) external view returns (euint64) {
        return _lenderBalance[account];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Self-service view helpers (msg.sender scoped)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the exact USDC amount the caller owes right now.
    ///         Uses msg.sender so each wallet only sees its own data.
    ///         Use this to determine how much USDC to approve before repay().
    function getMyTotalDue()
        external
        view
        returns (uint256 totalDue, uint256 principal, uint256 interest)
    {
        if (!_isActive[msg.sender]) return (0, 0, 0);
        principal = _borrowPrincipal[msg.sender];
        uint256 elapsed = (block.timestamp - loanStartTime[msg.sender]) / 60;
        interest  = (principal * INTEREST_BPS_PER_MINUTE * elapsed) / 10_000;
        totalDue  = principal + interest;
    }

    /// @notice Returns the caller's lender position: deposit, interest share, total payout.
    ///         Uses msg.sender so only you can read your own data via this function.
    function getMyLenderInfo()
        external
        view
        returns (uint256 deposit, uint256 interestShare, uint256 totalPayout)
    {
        deposit = _lenderPrincipal[msg.sender];
        interestShare = totalLenderDeposits > 0
            ? (deposit * totalInterestAccrued) / totalLenderDeposits
            : 0;
        totalPayout = deposit + interestShare;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Liquidation: health check
    // ─────────────────────────────────────────────────────────────────────────

    function requestLiquidationCheck(address borrower) external {
        if (!_isActive[borrower]) revert NoCollateral();
        if (_hasPendingCheck[borrower]) revert AlreadyPendingCheck();

        euint64 encCollateral = cETH.confidentialBalanceOf(borrower);
        euint64 encDebt       = cUSDC.confidentialBalanceOf(borrower);

        euint64 collateralValue = FHE.mul(encCollateral, FHE.asEuint64(ETH_PRICE_USD * HEALTH_MULTIPLIER));
        euint64 debtThreshold   = FHE.mul(encDebt, FHE.asEuint64(LIQUIDATION_THRESHOLD));
        ebool isUnhealthy       = FHE.lt(collateralValue, debtThreshold);

        _pendingHealthCheck[borrower] = isUnhealthy;
        _hasPendingCheck[borrower]    = true;
        FHE.allowThis(isUnhealthy);
        FHE.makePubliclyDecryptable(isUnhealthy);

        _triggerAgent[borrower] = tx.origin;

        emit LiquidationCheckRequested(borrower, isUnhealthy);
    }

    function resolveHealthCheck(
        address borrower,
        bytes calldata abiEncodedClearResult,
        bytes calldata decryptionProof
    ) external onlyDecryptor {
        if (!_hasPendingCheck[borrower]) revert NoPendingCheck();

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(_pendingHealthCheck[borrower]);
        FHE.checkSignatures(cts, abiEncodedClearResult, decryptionProof);

        bool isUnhealthy = abi.decode(abiEncodedClearResult, (bool));
        _hasPendingCheck[borrower] = false;

        emit HealthCheckResolved(borrower, isUnhealthy);
        if (isUnhealthy) _triggerLiquidation(borrower);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Liquidation: settlement
    // ─────────────────────────────────────────────────────────────────────────

    function settleLiquidation(address borrower, address bidder, uint256 ethPaid) external {
        if (msg.sender != auctionContract) revert OnlyAuction();

        uint256 collateralEth = collateralGwei[borrower] * 1 gwei;
        uint256 triggerFee    = (collateralEth * TRIGGER_FEE_BPS) / 10_000;
        address triggerAgent  = _triggerAgent[borrower];

        cUSDC.wipe(borrower);

        euint64 encColl = FHE.asEuint64(uint64(collateralGwei[borrower]));
        FHE.allowTransient(encColl, address(cETH));
        cETH.burn(borrower, encColl);

        totalCollateralGwei         -= collateralGwei[borrower];
        collateralGwei[borrower]     = 0;
        _borrowPrincipal[borrower]   = 0;
        _isActive[borrower]          = false;
        hasCollateral[borrower]      = false;
        _removePosition(borrower);
        delete _triggerAgent[borrower];

        if (triggerFee > 0 && triggerAgent != address(0)) {
            (bool ok,) = triggerAgent.call{value: triggerFee}("");
            require(ok, "Trigger fee transfer failed");
        }

        protocolEthEarnings += ethPaid - triggerFee;
        bidder; // receives collateral via auction contract
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Access control
    // ─────────────────────────────────────────────────────────────────────────

    function grantAgentAccess(address account, address agent) external {
        if (msg.sender != owner) revert OnlyOwner();
        cETH.grantReadAccess(account, agent);
        cUSDC.grantReadAccess(account, agent);
        emit AgentAccessGranted(account, agent);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public view helpers
    // ─────────────────────────────────────────────────────────────────────────

    function getActivePositions() external view returns (address[] memory) {
        return _activePositions;
    }

    function getProtocolStats() external view returns (
        uint256 totalCollateral,
        uint256 activeBorrowers,
        uint256 totalLenders
    ) {
        totalCollateral = totalCollateralGwei;
        activeBorrowers = _activePositions.length;
        totalLenders    = _lenderAddresses.length;
    }

    function getPositionHandles(address borrower)
        external view
        returns (euint64 encCollateral, euint64 encDebt)
    {
        encCollateral = cETH.confidentialBalanceOf(borrower);
        encDebt       = cUSDC.confidentialBalanceOf(borrower);
    }

    function getLoanInfo(address borrower)
        external view
        returns (
            uint256 startTime,
            uint256 termSeconds,
            uint256 dueTime,
            bool isOverdue,
            bool isActive
        )
    {
        startTime  = loanStartTime[borrower];
        termSeconds = loanTermSeconds[borrower];
        dueTime    = startTime + termSeconds;
        isOverdue  = startTime > 0 && block.timestamp > dueTime;
        isActive   = _isActive[borrower];
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

interface IDutchAuction {
    function startAuction(address borrower, uint256 collateralGwei) external;
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
