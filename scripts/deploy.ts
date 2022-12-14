import { ethers, network } from 'hardhat'
import {
  OracleLib,
  OracleLib__factory,
  CvxCurveStableLPCollateral,
  CvxCurveStableLPCollateral__factory,
  ConvexStakingWrapper,
  ConvexStakingWrapper__factory,
} from '../typechain-types'
import { networkConfig } from './configuration'

async function main() {
  const [deployer] = await ethers.getSigners()

  console.log(`Starting full deployment on network ${network.name}`)
  console.log(`Deployer account: ${deployer.address}\n`)

  const config = networkConfig[network.name]

  if (config.oracleLib === undefined) {
    const OracleLibFactory: OracleLib__factory = await ethers.getContractFactory('OracleLib')
    const oracleLib = <OracleLib>await OracleLibFactory.deploy()
    await oracleLib.deployed()
    config.oracleLib = oracleLib.address
    console.log(`Wrapped oracleLib deployed to ${oracleLib.address}`)
  }

  if (config.convexStakingWrapper == undefined) {
    const CvxMiningFactory = await ethers.getContractFactory('CvxMining')
    const cvxMining = await CvxMiningFactory.deploy()

    const ConvexStakingWrapperFactory = <ConvexStakingWrapper__factory>(
      await ethers.getContractFactory('ConvexStakingWrapper', {
        libraries: {
          CvxMining: cvxMining.address,
        },
      })
    )
    const convexStakingWrapper = <ConvexStakingWrapper>await ConvexStakingWrapperFactory.deploy()
    await convexStakingWrapper.initialize(config.convexPoolId)
    config.convexStakingWrapper = convexStakingWrapper.address
  }

  const CvxCurveStableLPCollateralFactory: CvxCurveStableLPCollateral__factory =
    await ethers.getContractFactory('CvxCurveStableLPCollateral', {
      libraries: { OracleLib: config.oracleLib },
    })

  const deployConfig: CvxCurveStableLPCollateral.ConfigurationStruct = {
    ...config.collateralOpts,
    wrappedStakeToken: config.convexStakingWrapper,
  }

  const collateral = <CvxCurveStableLPCollateral>(
    await CvxCurveStableLPCollateralFactory.deploy(deployConfig)
  )

  console.log(
    `Deploying CvxCurveStableLPCollateral with transaction ${collateral.deployTransaction.hash}`
  )
  await collateral.deployed()

  console.log(
    `CvxCurveStableLPCollateral deployed to ${collateral.address} as collateral to ${config.convexStakingWrapper}`
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
