import { expect } from 'chai'
import { ethers } from 'hardhat'

describe('CvxCurveStableLPCollateral', () => {
  it('does things', async () => {
    const booster = await ethers.getContractAt(
      'ConvexBooster',
      '0xF403C135812408BFbE8713b5A23a04b3D48AAE31'
    )

    console.log(await booster.poolInfo(8))
  })
})
