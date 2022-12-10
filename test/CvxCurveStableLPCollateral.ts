import { expect } from 'chai'
import { ethers } from 'hardhat'
import { deployCollateral } from './fixtures'
import { THREE_POOL } from './helpers'

describe('CvxCurveStableLPCollateral', () => {
  describe('lpTokenPrice', () => {
    it('returns price per lp token', async () => {
      const collateral = await deployCollateral()

      expect(await collateral.lpTokenPrice()).to.eq(1022155557920163600n)
    })
  })
})
