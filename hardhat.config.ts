import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-verify';
import dotenv from 'dotenv';
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  defaultNetwork: 'local',
  networks: {
    polygon: {
      url: `https://polygon-mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID!}`,
      chainId: 137,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    },
    amoy: {
      url: `https://polygon-amoy.infura.io/v3/${process.env.INFURA_PROJECT_ID!}`,
      chainId: 80002,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    },
    local: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
      },
    },
    hardhat: {
      accounts: {
        count: 10, // Default is 20, adjust as needed
      }
    },
  },
  etherscan: {
    apiKey: process.env.POLYGONSCAN_API_KEY!,
  },
  sourcify: {
    enabled: false
  },
};

export default config;
