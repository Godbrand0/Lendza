// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title DutchAuction
/// @notice Encrypted Dutch auction engine for ARGEN × ZAMA liquidations.
///
///  ┌─ Price curve ──────────────────────────────────────────────────────────┐
///  │  Starts at 100% of collateral ETH value, descends linearly to a 70%   │
///  │  floor over AUCTION_DURATION (1 hour). Price is PUBLIC — bidders need  │
///  │  it to decide when to bid.                                             │
///  └────────────────────────────────────────────────────────────────────────┘
///
///  ┌─ Encrypted bid flow ───────────────────────────────────────────────────┐
///  │  1. Bidder calls submitBid(auctionId, encMaxBid, proof) + sends ETH    │
///  │     as deposit (must cover at least the floor price).                  │
///  │  2. Anyone calls requestBidResolution(auctionId, bidder) once they     │
///  │     believe the public price has dropped to the bidder's level.        │
///  │     → FHE computes: valid = currentPrice ≤ encMaxBid                  │
///  │     → FHE.makePubliclyDecryptable(valid)                               │
///  │  3. Zama relayer calls resolveBid(auctionId, bidder, result, proof).   │
///  │     → If valid: bidder wins at currentPrice, overpaid ETH refunded,   │
///  │       ConfidentialVault.settleLiquidation() called.                   │
///  │     → If invalid: deposit returned, bidder may resubmit.              │
///  └────────────────────────────────────────────────────────────────────────┘
///
/// @dev Bid amounts are encrypted so competitors cannot see each other's ceilings.
contract DutchAuction is ZamaEthereumConfig {
    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice How long a single auction runs (seconds).
    uint256 public constant AUCTION_DURATION = 1 hours;

    /// @notice Price floor as a fraction of start price (70%).
    uint256 public constant FLOOR_BPS = 7_000;

    uint256 private constant BPS_DENOMINATOR = 10_000;

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct Auction {
        address borrower;
        uint256 startPrice;     // wei — 100% of collateral ETH value at auction start
        uint256 floorPrice;     // wei — 70% floor
        uint256 startTime;
        bool settled;
    }

    struct Bid {
        address bidder;
        euint64 encMaxBid;      // bidder's encrypted ceiling in gwei
        uint256 deposit;        // ETH deposited (wei) — must cover floorPrice
        bool resolutionPending;
        bool resolved;
        bool won;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    address public immutable vault;

    uint256 private _nextAuctionId;
    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => address[]) private _bidders;            // auctionId → bidders
    mapping(uint256 => mapping(address => Bid)) private _bids; // auctionId → bidder → Bid

    /// @dev Pending resolution ebool, stored so resolveAuction() can verify proof.
    mapping(uint256 => mapping(address => ebool)) private _pendingValid;

    /// @dev Tracks whether a resolution is pending per (auctionId, bidder).
    ///      Separate bool required because `delete` cannot be applied to ebool.
    mapping(uint256 => mapping(address => bool)) private _hasPendingValid;

    uint256[] private _activeAuctionIds;
    mapping(uint256 => bool) private _isActive;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event AuctionStarted(uint256 indexed auctionId, address indexed borrower, uint256 startPrice);
    event BidSubmitted(uint256 indexed auctionId, address indexed bidder);
    event BidResolutionRequested(uint256 indexed auctionId, address indexed bidder, ebool validHandle);
    event AuctionSettled(uint256 indexed auctionId, address indexed winner, uint256 pricePaid);
    event BidRefunded(uint256 indexed auctionId, address indexed bidder);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Zama relayer address on Sepolia that calls resolveBid().
    address public constant DECRYPTION_ADDRESS = 0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478;

    error OnlyVault();
    error OnlyDecryptor();
    error AuctionNotActive();
    error AuctionAlreadySettled();
    error AuctionExpired();
    error AuctionNotExpired();
    error BidAlreadySubmitted();
    error InsufficientDeposit(uint256 required, uint256 provided);
    error NoBidFound();
    error ResolutionAlreadyPending();
    error NoResolutionPending();
    error ETHTransferFailed();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    modifier onlyDecryptor() {
        if (msg.sender != DECRYPTION_ADDRESS) revert OnlyDecryptor();
        _;
    }

    constructor(address _vault) {
        vault = _vault;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vault: start auction
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Called by ConfidentialVault when a position is found unhealthy.
    /// @param borrower        Owner of the position being liquidated.
    /// @param collateralGwei  Plaintext collateral in gwei (used to set start price).
    function startAuction(address borrower, uint256 collateralGwei) external {
        if (msg.sender != vault) revert OnlyVault();

        uint256 startPrice = collateralGwei * 1 gwei; // 100% of collateral in wei
        uint256 floorPrice = (startPrice * FLOOR_BPS) / BPS_DENOMINATOR; // 70% floor

        uint256 id = _nextAuctionId++;
        auctions[id] = Auction({
            borrower: borrower,
            startPrice: startPrice,
            floorPrice: floorPrice,
            startTime: block.timestamp,
            settled: false
        });

        _activeAuctionIds.push(id);
        _isActive[id] = true;

        emit AuctionStarted(id, borrower, startPrice);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bidder: submit bid
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Submit an encrypted max bid and lock a deposit.
    ///         Deposit must be ≥ floorPrice so the vault can always be made whole.
    ///         msg.value is the ETH deposit; the actual payment is currentPrice at resolution.
    ///
    /// @param auctionId      Auction to bid on.
    /// @param encMaxBid      FHE-encrypted maximum price (in gwei) this bidder will pay.
    /// @param inputProof     Proof from fhevmjs.
    function submitBid(
        uint256 auctionId,
        externalEuint64 encMaxBid,
        bytes calldata inputProof
    ) external payable {
        Auction storage auction = auctions[auctionId];
        if (!_isActive[auctionId]) revert AuctionNotActive();
        if (auction.settled) revert AuctionAlreadySettled();
        if (block.timestamp >= auction.startTime + AUCTION_DURATION) revert AuctionExpired();
        if (_bids[auctionId][msg.sender].bidder != address(0)) revert BidAlreadySubmitted();
        if (msg.value < auction.floorPrice) {
            revert InsufficientDeposit(auction.floorPrice, msg.value);
        }

        euint64 bidHandle = FHE.fromExternal(encMaxBid, inputProof);

        _bids[auctionId][msg.sender] = Bid({
            bidder: msg.sender,
            encMaxBid: bidHandle,
            deposit: msg.value,
            resolutionPending: false,
            resolved: false,
            won: false
        });
        _bidders[auctionId].push(msg.sender);

        FHE.allowThis(bidHandle);
        FHE.allow(bidHandle, msg.sender);
        FHE.allow(bidHandle, vault);

        emit BidSubmitted(auctionId, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resolution: request decryption
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Anyone can call this to check whether `bidder`'s encrypted max bid
    ///         covers the current auction price. Triggers a Zama Gateway decryption.
    function requestBidResolution(uint256 auctionId, address bidder) external {
        Auction storage auction = auctions[auctionId];
        if (!_isActive[auctionId]) revert AuctionNotActive();
        if (auction.settled) revert AuctionAlreadySettled();

        Bid storage bid = _bids[auctionId][bidder];
        if (bid.bidder == address(0)) revert NoBidFound();
        if (bid.resolutionPending) revert ResolutionAlreadyPending();
        if (bid.resolved) revert ResolutionAlreadyPending();

        // Current public price (in gwei) at this moment.
        uint256 currentPriceWei = getCurrentPrice(auctionId);
        uint64 currentPriceGwei = uint64(currentPriceWei / 1 gwei);

        // Encrypted comparison: valid = encMaxBid >= currentPrice
        ebool valid = FHE.ge(bid.encMaxBid, FHE.asEuint64(currentPriceGwei));

        _pendingValid[auctionId][bidder] = valid;
        _hasPendingValid[auctionId][bidder] = true;
        FHE.allowThis(valid);

        bid.resolutionPending = true;

        // Hand to Zama relayer for decryption.
        FHE.makePubliclyDecryptable(valid);

        emit BidResolutionRequested(auctionId, bidder, valid);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resolution: relayer callback
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Called by the Zama relayer with the decrypted result.
    ///         If the bid was valid, settle the auction. Otherwise, refund the deposit.
    ///
    /// @param auctionId            Auction being resolved.
    /// @param bidder               Bidder whose validity was checked.
    /// @param abiEncodedClearResult  ABI-encoded bool: true = bid was valid.
    /// @param decryptionProof      KMS signature.
    function resolveBid(
        uint256 auctionId,
        address bidder,
        bytes calldata abiEncodedClearResult,
        bytes calldata decryptionProof
    ) external onlyDecryptor {
        Auction storage auction = auctions[auctionId];
        if (!_isActive[auctionId]) revert AuctionNotActive();
        if (auction.settled) revert AuctionAlreadySettled();

        Bid storage bid = _bids[auctionId][bidder];
        if (!bid.resolutionPending) revert NoResolutionPending();

        // Verify the decryption proof.
        ebool pendingValid = _pendingValid[auctionId][bidder];
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(pendingValid);
        FHE.checkSignatures(cts, abiEncodedClearResult, decryptionProof);

        bool isValid = abi.decode(abiEncodedClearResult, (bool));

        bid.resolutionPending = false;
        bid.resolved = true;
        _hasPendingValid[auctionId][bidder] = false;

        if (isValid) {
            bid.won = true;
            _settleAuction(auctionId, bidder);
        } else {
            _refundBid(auctionId, bidder);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fallback: auction expired with no valid bids
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice If the auction expires without a valid bid, the vault may cancel it.
    function cancelExpiredAuction(uint256 auctionId) external {
        if (msg.sender != vault) revert OnlyVault();
        Auction storage auction = auctions[auctionId];
        if (block.timestamp < auction.startTime + AUCTION_DURATION) revert AuctionNotExpired();
        if (auction.settled) revert AuctionAlreadySettled();

        auction.settled = true;
        _removeActiveAuction(auctionId);

        // Refund all depositors.
        address[] memory bidders = _bidders[auctionId];
        for (uint256 i = 0; i < bidders.length; i++) {
            Bid storage b = _bids[auctionId][bidders[i]];
            if (!b.resolved && b.deposit > 0) {
                uint256 refund = b.deposit;
                b.deposit = 0;
                b.resolved = true;
                (bool ok, ) = bidders[i].call{value: refund}("");
                if (!ok) revert ETHTransferFailed();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the current auction price in wei.
    ///         Linear descent from startPrice to floorPrice over AUCTION_DURATION.
    function getCurrentPrice(uint256 auctionId) public view returns (uint256) {
        Auction storage auction = auctions[auctionId];
        if (auction.settled) return auction.floorPrice;

        uint256 elapsed = block.timestamp - auction.startTime;
        if (elapsed >= AUCTION_DURATION) return auction.floorPrice;

        uint256 priceRange = auction.startPrice - auction.floorPrice;
        uint256 discount = (priceRange * elapsed) / AUCTION_DURATION;
        return auction.startPrice - discount;
    }

    /// @notice Returns all unsettled auction IDs.
    function getActiveAuctions() external view returns (uint256[] memory) {
        return _activeAuctionIds;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    function _settleAuction(uint256 auctionId, address winner) internal {
        Auction storage auction = auctions[auctionId];
        auction.settled = true;
        _removeActiveAuction(auctionId);

        uint256 currentPrice = getCurrentPrice(auctionId);
        Bid storage bid = _bids[auctionId][winner];

        // Refund overpayment.
        uint256 overpay = bid.deposit - currentPrice;
        bid.deposit = 0;
        if (overpay > 0) {
            (bool ok, ) = winner.call{value: overpay}("");
            if (!ok) revert ETHTransferFailed();
        }

        // Notify vault to transfer collateral and close position.
        IConfidentialVault(vault).settleLiquidation{value: currentPrice}(
            auction.borrower,
            winner,
            currentPrice
        );

        emit AuctionSettled(auctionId, winner, currentPrice);
    }

    function _refundBid(uint256 auctionId, address bidder) internal {
        Bid storage bid = _bids[auctionId][bidder];
        uint256 refund = bid.deposit;
        bid.deposit = 0;
        (bool ok, ) = bidder.call{value: refund}("");
        if (!ok) revert ETHTransferFailed();
        emit BidRefunded(auctionId, bidder);
    }

    function _removeActiveAuction(uint256 auctionId) internal {
        _isActive[auctionId] = false;
        uint256 len = _activeAuctionIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (_activeAuctionIds[i] == auctionId) {
                _activeAuctionIds[i] = _activeAuctionIds[len - 1];
                _activeAuctionIds.pop();
                break;
            }
        }
    }

    receive() external payable {}
}

/// @dev Minimal interface for calling back into the Vault on settlement.
interface IConfidentialVault {
    function settleLiquidation(address borrower, address bidder, uint256 ethPaid) external payable;
}
