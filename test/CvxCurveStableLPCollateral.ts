import { expect } from 'chai'
import { ethers } from 'hardhat'
import { deployCollateral } from './fixtures'
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
  })

  describe('prices', () => {
    it('returns price per lp token', async () => {
      const collateral = await deployCollateral()

      expect(await collateral.strictPrice()).to.eq(1022160092729999097n)
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

      const dai = await ethers.getContractAt('ERC20', DAI)
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
      expect(prevPrice).to.be.lt(newPrice)
      prevPrice = newPrice

      const usdc = await ethers.getContractAt('ERC20', USDC)
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
})
