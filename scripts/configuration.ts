import { ethers } from 'hardhat'

interface NetworkConfig {
  collateralOpts: CollateralOptsConfig
  oracleLib?: string // Address of OracleLib. Set this if you want to use an existing deployment of OracleLib.
  convexStakingWrapper?: string // Address of Wrapper Token for Staked Convex. Set this if you want to use an existing deployment of ConvexStakingWrapper.
  convexPoolId: number
}

interface CollateralOptsConfig {
  lpToken: string
  nTokens: number
  tokensPriceFeeds: string[][]
  targetPegFeed: string
  curvePool: string
  targetName: string
  oracleTimeout: bigint
  fallbackPrice: bigint
  maxTradeVolume: bigint
  poolRatioThreshold: bigint
  defaultThreshold: bigint
  delayUntilDefault: bigint
  poolType: number
}

export const networkConfig: { [key: string]: NetworkConfig } = {
  mainnet: {
    // mainnet settings
    convexPoolId: 9, // This is the Pool ID for TRI-POOL in Convex
    collateralOpts: {
      lpToken: '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490', // The Pool token for the Curve Pool
      nTokens: 3, // The number of tokens in the Curve Pool. This is the underlying for Lending pools and the base for Metapools.
      curvePool: '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7', // The address of the Curve Pool
      tokensPriceFeeds: [
        ['0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'],
        ['0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'],
        ['0x3E7d1eAB13ad0104d2750B8863b489D65364e32D'],
      ], // These are the price feeds for each of the pool's tokens
      targetPegFeed: ethers.constants.AddressZero, // This is the address of the price feed for the target unit. If target unit is fiat, use zero address
      poolType: 0, // This is the Curve Pool Type which is either Plain (0), Lending (1), or Metapool (2)
      poolRatioThreshold: 3n * 10n ** 17n, // 30%
      targetName: ethers.utils.formatBytes32String('USD'), // Name of target unit in bytes format
      oracleTimeout: 86400n, // Seconds that an oracle value is considered valid
      fallbackPrice: 1n * 10n ** 18n, // Price given when price computation reverts
      maxTradeVolume: 1000000n, // The max trade volume, in UoA
      defaultThreshold: 5n * 10n ** 16n, // A value like 0.05 that represents a deviation tolerance
      delayUntilDefault: 86400n, // The number of seconds deviation must occur before default
    },
  },
}
