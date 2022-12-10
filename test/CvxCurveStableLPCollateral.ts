import { expect } from 'chai'
import { ethers } from 'hardhat'
import { deployCollateral } from './fixtures'
import { THREE_POOL, USDC, USDC_USD_FEED } from './helpers'

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

  describe('strictPrice', () => {
    it('returns price per lp token', async () => {
      const collateral = await deployCollateral()

      expect(await collateral.strictPrice()).to.eq(1022155557920163600n)
    })
  })
})
