// SPDX-License-Identifier: ISC
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "reserve/contracts/libraries/Fixed.sol";
import "reserve/contracts/interfaces/IAsset.sol";
import "./PoolTokens.sol";

/**
 * @title CvxCurveStableLPCollateral
 */
contract CvxCurveStableLPCollateral is PoolTokens {
    using FixLib for uint192;

    struct Configuration {
        AggregatorV3Interface[][] tokensPriceFeeds;
        ICurvePool curvePool;
        bytes32 targetName;
        uint48 oracleTimeout;
        uint192 fallbackPrice;
        uint192 maxTradeVolume;
        uint192 defaultThreshold;
        uint256 delayUntilDefault;
    }

    IERC20Metadata public immutable erc20;
    uint8 public immutable token0decimals;
    uint8 public immutable token1decimals;
    uint8 public immutable erc20Decimals;
    uint48 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid
    uint192 public immutable maxTradeVolume; // {UoA}
    uint192 public immutable fallbackPrice; // {UoA}
    uint192 public immutable defaultThreshold; // {%} e.g. 0.05
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    uint256 public immutable delayUntilDefault; // {s} e.g 86400
    uint256 private constant NEVER = type(uint256).max;
    uint256 private _whenDefault = NEVER;
    bytes32 public immutable targetName;

    constructor(Configuration memory config) {
        require(config.fallbackPrice > 0, "fallback price zero");
        require(config.maxTradeVolume > 0, "invalid max trade volume");
        require(config.defaultThreshold > 0, "defaultThreshold zero");
        require(config.targetName != bytes32(0), "targetName missing");
        require(config.delayUntilDefault > 0, "delayUntilDefault zero");

        targetName = config.targetName;
        delayUntilDefault = config.delayUntilDefault;
        fallbackPrice = config.fallbackPrice;
        erc20Decimals = erc20.decimals();
        maxTradeVolume = config.maxTradeVolume;
        oracleTimeout = config.oracleTimeout;
        defaultThreshold = config.defaultThreshold;

        prevReferencePrice = refPerTok();
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external {
        // == Refresh ==
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();
        // Check for hard default
        uint192 referencePrice = refPerTok();
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        }
        // } else {
        //     if (
        //         pegNotMaintained(this.token0price) ||
        //         pegNotMaintained(this.token1price) ||
        //         pegNotMaintained(this.tokensRatio)
        //     ) {
        //         markStatus(CollateralStatus.IFFY);
        //     } else {
        //         markStatus(CollateralStatus.SOUND);
        //     }
        // }
        prevReferencePrice = referencePrice;
        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
        // No interactions beyond the initial refresher
    }

    function pegNotMaintained(
        function() external view returns (uint192) priceFunc
    ) internal view returns (bool) {
        try priceFunc() returns (uint192 p) {
            // Check for soft default of underlying reference token
            uint192 peg = targetPerRef();
            // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
            uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}
            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            return (p < peg - delta || p > peg + delta);
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            return true;
        }
    }

    function strictPrice() public view returns (uint192) {
        return FIX_ONE;
    }

    /// Can return 0
    /// Cannot revert if `allowFallback` is true. Can revert if false.
    /// @param allowFallback Whether to try the fallback price in case precise price reverts
    /// @return isFallback If the price is a allowFallback price
    /// @return {UoA/tok} The current price, or if it's reverting, a fallback price
    function price(bool allowFallback) public view returns (bool isFallback, uint192) {
        try this.strictPrice() returns (uint192 p) {
            return (false, p);
        } catch {
            require(allowFallback, "price reverted without failover enabled");
            return (true, fallbackPrice);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view returns (uint192) {
        return curvePool.get_virtual_price();
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public pure returns (uint192) {
        return FIX_ONE;
    }

    /// @return The collateral's status
    function status() public view override returns (CollateralStatus) {
        if (_whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (_whenDefault > block.timestamp) {
            return CollateralStatus.IFFY;
        } else {
            return CollateralStatus.DISABLED;
        }
    }

    function bal(address account) external view returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
    }

    function claimRewards() external {}

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure returns (bool) {
        return true;
    }

    // === Helpers ===

    function markStatus(CollateralStatus status_) internal {
        if (_whenDefault <= block.timestamp) return; // prevent DISABLED -> SOUND/IFFY
        if (status_ == CollateralStatus.SOUND) {
            _whenDefault = NEVER;
        } else if (status_ == CollateralStatus.IFFY) {
            _whenDefault = Math.min(block.timestamp + delayUntilDefault, _whenDefault);
        } else if (status_ == CollateralStatus.DISABLED) {
            _whenDefault = block.timestamp;
        }
    }

    function alreadyDefaulted() internal view returns (bool) {
        return _whenDefault <= block.timestamp;
    }

    function whenDefault() public view returns (uint256) {
        return _whenDefault;
    }
}
