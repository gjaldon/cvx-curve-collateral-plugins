import { expect } from 'chai'
import { ethers } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { MockV3Aggregator, MockV3Aggregator__factory } from '../typechain-types'
import { deployCollateral, makeReserveProtocol } from './fixtures'
import {
  DAI_USD_FEED,
  THREE_POOL,
  USDC,
  USDC_USD_FEED,
  exp,
  whileImpersonating,
  DAI_HOLDER,
  DAI,
  USDT_USD_FEED,
  CollateralStatus,
  USDT,
  THREE_POOL_HOLDER,
  THREE_POOL_TOKEN,
  FIX_ONE,
  resetFork,
  COMP,
  MAX_TRADE_VOL,
  RSR,
} from './helpers'

describe('CvxCurveStableLPCollateral', () => {
  describe('constructor validation', () => {
    it('validates targetName', async () => {
      await expect(deployCollateral({ targetName: ethers.constants.HashZero })).to.be.revertedWith(
        'targetName missing'
      )
    })

    it('requires wrapped stake token', async () => {
      await expect(
        deployCollateral({ wrappedStakeToken: ethers.constants.AddressZero })
      ).to.be.revertedWith('wrappedStakeToken address is zero')
    })

    it('does not allow lpToken address as zero', async () => {
      await expect(deployCollateral({ lpToken: ethers.constants.AddressZero })).to.be.revertedWith(
        'lp token address is zero'
      )
    })

    it('does not allow curve pool address as zero', async () => {
      await expect(
        deployCollateral({ curvePool: ethers.constants.AddressZero })
      ).to.be.revertedWith('curvePool address is zero')
    })

    it('does not allow tokens that do not match tokens in pool', async () => {
      await expect(deployCollateral({ poolTokens: [USDC] })).to.be.revertedWith(
        'tokens must match index in pool'
      )
    })

    it('must have feeds limited to 3', async () => {
      await expect(
        deployCollateral({
          tokensPriceFeeds: [[USDC_USD_FEED, USDC_USD_FEED, USDC_USD_FEED, USDC_USD_FEED]],
        })
      ).to.be.revertedWith('price feeds limited to 3')
    })

    it('needs at least 1 price feed for each token', async () => {
      await expect(deployCollateral({ tokensPriceFeeds: [[USDC_USD_FEED]] })).to.be.revertedWith(
        'each token needs at least 1 price feed'
      )
    })

    it('max trade volume must be greater than zero', async () => {
      await expect(deployCollateral({ maxTradeVolume: 0n })).to.be.revertedWith(
        'invalid max trade volume'
      )
    })

    it('does not allow oracle timeout at 0', async () => {
      await expect(deployCollateral({ oracleTimeout: 0n })).to.be.revertedWith('oracleTimeout zero')
    })

    it('does not allow missing defaultThreshold', async () => {
      await expect(deployCollateral({ defaultThreshold: 0n })).to.be.revertedWith(
        'defaultThreshold zero'
      )
    })

    it('does not allow missing delayUntilDefault', async () => {
      await expect(deployCollateral({ delayUntilDefault: 0n })).to.be.revertedWith(
        'delayUntilDefault zero'
      )
    })

    it('does not allow zero fallbackPrice', async () => {
      await expect(deployCollateral({ fallbackPrice: 0n })).to.be.revertedWith(
        'fallback price zero'
      )
    })

    it('does not allow targetPegFeeds with length that does not match poolTokens', async () => {
      await expect(deployCollateral({ targetPegFeeds: [] })).to.be.revertedWith(
        'targetPegFeeds length must match poolTokens'
      )

      const zero = ethers.constants.AddressZero
      await expect(
        deployCollateral({ targetPegFeeds: [zero, zero, zero, zero] })
      ).to.be.revertedWith('targetPegFeeds length must match poolTokens')
    })
  })

  describe('prices', () => {
    it('returns price per lp token', async () => {
      const collateral = await deployCollateral()

      expect(await collateral.strictPrice()).to.eq(1022619554689953605n)
    })

    it('price changes as USDC and USDT prices change in Curve 3Pool', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const mockUSDCfeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const mockUSDTfeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))

      const collateral = await deployCollateral({
        tokensPriceFeeds: [[DAI_USD_FEED], [mockUSDCfeed.address], [mockUSDTfeed.address]],
      })
      let prevPrice = await collateral.strictPrice()

      await mockUSDCfeed.updateAnswer(exp(2, 6))
      let newPrice = await collateral.strictPrice()
      expect(newPrice).to.be.gt(prevPrice)
      prevPrice = newPrice

      await mockUSDTfeed.updateAnswer(exp(2, 6))
      newPrice = await collateral.strictPrice()
      expect(newPrice).to.be.gt(prevPrice)
    })

    it('price changes as swaps occur', async () => {
      const collateral = await deployCollateral()
      const [swapper] = await ethers.getSigners()
      let prevPrice = await collateral.strictPrice()

      const dai = await ethers.getContractAt(
        '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20',
        DAI
      )
      const threePool = await ethers.getContractAt('ICurvePool', THREE_POOL)
      await dai.approve(threePool.address, ethers.constants.MaxUint256)

      await whileImpersonating(DAI_HOLDER, async (signer) => {
        const balance = await dai.balanceOf(signer.address)
        await dai.connect(signer).transfer(swapper.address, balance)
      })

      await expect(
        threePool.exchange(0, 1, exp(100_000, 18), exp(98_000, 6))
      ).to.changeTokenBalance(dai, swapper.address, `-${exp(100_000, 18)}`)

      let newPrice = await collateral.strictPrice()
      expect(prevPrice).to.not.eq(newPrice)
      prevPrice = newPrice

      const usdc = await ethers.getContractAt(
        '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20',
        USDC
      )
      await usdc.approve(threePool.address, ethers.constants.MaxUint256)
      await expect(threePool.exchange(1, 2, exp(90_000, 6), exp(89_000, 6))).to.changeTokenBalance(
        usdc,
        swapper.address,
        `-${exp(90_000, 6)}`
      )

      newPrice = await collateral.strictPrice()
      expect(prevPrice).to.be.lt(newPrice)
    })

    it('reverts if USDC price is zero', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const chainlinkFeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[DAI_USD_FEED], [chainlinkFeed.address], [USDT_USD_FEED]],
      })

      // Set price of USDC to 0
      const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
      await updateAnswerTx.wait()
      // Check price of token
      await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
        collateral,
        'PriceOutsideRange'
      )
      // Fallback price is returned
      const [isFallback, price] = await collateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(await collateral.fallbackPrice())
      // When refreshed, sets status to Unpriced
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('reverts if DAI price is zero', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const chainlinkFeed = await MockV3AggregatorFactory.deploy(18, exp(1, 18))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[chainlinkFeed.address], [USDC_USD_FEED], [USDT_USD_FEED]],
      })

      // Set price of DAI to 0
      const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
      await updateAnswerTx.wait()
      // Check price of token
      await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
        collateral,
        'PriceOutsideRange'
      )
      // Fallback price is returned
      const [isFallback, price] = await collateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(await collateral.fallbackPrice())
      // When refreshed, sets status to Unpriced
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('reverts if USDT price is zero', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const chainlinkFeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[DAI_USD_FEED], [USDC_USD_FEED], [chainlinkFeed.address]],
      })

      // Set price of USDT to 0
      const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
      await updateAnswerTx.wait()
      // Check price of token
      await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
        collateral,
        'PriceOutsideRange'
      )
      // Fallback price is returned
      const [isFallback, price] = await collateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(await collateral.fallbackPrice())
      // When refreshed, sets status to Unpriced
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('reverts in case of invalid timestamp', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const chainlinkFeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[DAI_USD_FEED], [USDC_USD_FEED], [chainlinkFeed.address]],
      })
      await chainlinkFeed.setInvalidTimestamp()
      // Check price of token
      await expect(collateral.strictPrice()).to.be.revertedWithCustomError(collateral, 'StalePrice')
      // When refreshed, sets status to Unpriced
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    })
  })

  describe('status', () => {
    it('maintains status in normal situations', async () => {
      const collateral = await deployCollateral()
      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Force updates (with no changes)
      await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')

      // State remains the same
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)
    })

    it('recovers from soft-default', async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )
      const daiMockFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, exp(1, 18))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[daiMockFeed.address], [USDC_USD_FEED], [USDT_USD_FEED]],
      })

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
      await daiMockFeed.updateAnswer(exp(8, 17))

      await expect(collateral.refresh())
        .to.emit(collateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

      // DAI:USD peg recovers back to 1:1
      await daiMockFeed.updateAnswer(exp(1, 18))

      // Collateral becomes sound again because peg has recovered
      await expect(collateral.refresh())
        .to.emit(collateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.IFFY, CollateralStatus.SOUND)
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    })

    it('soft-defaults when DAI depegs from fiat target beyond threshold', async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )
      const daiMockFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, exp(1, 18))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[daiMockFeed.address], [USDC_USD_FEED], [USDT_USD_FEED]],
      })
      const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
      await daiMockFeed.updateAnswer(exp(8, 17))

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: bigint

      // Set next block timestamp - for deterministic result
      const nextBlockTimestamp = (await time.latest()) + 1
      await time.setNextBlockTimestamp(nextBlockTimestamp)
      expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

      await expect(collateral.refresh())
        .to.emit(collateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await time.increase(delayUntilDefault)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
      await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('soft-defaults when USDC depegs from fiat target beyond threshold', async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )
      const usdcMockFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[USDC_USD_FEED], [usdcMockFeed.address], [USDT_USD_FEED]],
      })
      const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
      await usdcMockFeed.updateAnswer(exp(8, 5))

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: bigint

      // Set next block timestamp - for deterministic result
      const nextBlockTimestamp = (await time.latest()) + 1
      await time.setNextBlockTimestamp(nextBlockTimestamp)
      expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

      await expect(collateral.refresh())
        .to.emit(collateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await time.increase(delayUntilDefault)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
      await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('soft-defaults when USDT depegs from fiat target beyond threshold', async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )
      const usdtMockFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[USDC_USD_FEED], [usdtMockFeed.address], [USDT_USD_FEED]],
      })
      const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
      await usdtMockFeed.updateAnswer(exp(8, 5))

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: bigint

      // Set next block timestamp - for deterministic result
      const nextBlockTimestamp = (await time.latest()) + 1
      await time.setNextBlockTimestamp(nextBlockTimestamp)
      expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

      await expect(collateral.refresh())
        .to.emit(collateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await time.increase(delayUntilDefault)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
      await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('soft-defaults when liquidity pool is unbalanced beyond threshold', async () => {
      const CurvePoolMockFactory = await ethers.getContractFactory('CurvePoolMock')
      const poolMock = await CurvePoolMockFactory.deploy(
        [exp(10_000, 18), exp(10_000, 6), exp(10_000, 18)],
        [DAI, USDC, USDT]
      )
      const collateral = await deployCollateral({
        curvePool: poolMock.address,
      })
      const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USDC - Set ratio of DAI reserves to USDC reserves 1:0.5
      await poolMock.setBalances([exp(20_000, 18), exp(10_000, 6), exp(16_000, 6)])

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: bigint

      // Set next block timestamp - for deterministic result
      const nextBlockTimestamp = (await time.latest()) + 1
      await time.setNextBlockTimestamp(nextBlockTimestamp)
      expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

      await expect(collateral.refresh())
        .to.emit(collateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await time.increase(delayUntilDefault)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
      await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
    })
  })

  describe('refPerTok', () => {
    // Swaps and huge swings in liquidity should not decrease refPerTok
    it('is mostly increasing', async () => {
      const collateral = await deployCollateral()
      let prevRefPerTok = await collateral.refPerTok()
      const [swapper] = await ethers.getSigners()
      const threePool = await ethers.getContractAt('StableSwap3Pool', THREE_POOL)

      const dai = await ethers.getContractAt(
        '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20',
        DAI
      )
      await dai.approve(threePool.address, ethers.constants.MaxUint256)
      await whileImpersonating(DAI_HOLDER, async (signer) => {
        const balance = await dai.balanceOf(signer.address)
        await dai.connect(signer).transfer(swapper.address, balance)
      })

      await expect(
        threePool.exchange(0, 1, exp(100_000, 18), exp(99_000, 6))
      ).to.changeTokenBalance(dai, swapper.address, `-${exp(100_000, 18)}`)

      let newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
      prevRefPerTok = newRefPerTok

      // Remove 30% of Liquidity. THREE_POOL_HOLDER ~30% of the supply of WBTC-ETH LP token
      const lpToken = await ethers.getContractAt(
        '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20',
        THREE_POOL_TOKEN
      )
      await whileImpersonating(THREE_POOL_HOLDER, async (signer) => {
        const balance = await lpToken.balanceOf(signer.address)
        await lpToken.connect(signer).transfer(swapper.address, balance)
      })
      const balance = await lpToken.balanceOf(swapper.address)
      await lpToken.approve(threePool.address, ethers.constants.MaxUint256)
      await expect(threePool.remove_liquidity(balance, [0, 0, 0])).to.changeTokenBalance(
        lpToken,
        swapper,
        `-${balance}`
      )

      newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
      prevRefPerTok = newRefPerTok

      const usdc = await ethers.getContractAt(
        '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20',
        USDC
      )
      const usdt = await ethers.getContractAt(
        '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20',
        USDT
      )

      const daiBal = await dai.balanceOf(swapper.address)
      const usdcBal = await usdc.balanceOf(swapper.address)
      const usdtBal = await usdt.balanceOf(swapper.address)
      await usdc.approve(threePool.address, ethers.constants.MaxUint256)
      await usdt.approve(threePool.address, ethers.constants.MaxUint256)

      await expect(
        threePool.add_liquidity([daiBal, usdcBal, usdtBal], [0, 0, 0])
      ).to.changeTokenBalance(dai, swapper.address, `-${daiBal}`)

      newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
    })
  })
})
