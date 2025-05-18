require("@nomicfoundation/hardhat-toolbox");
require("hardhat-gas-reporter");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 999999,
      },
      viaIR: false
    }
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545"
    },
  },
  gasReporter: {
    enabled: true,                 
    currency: 'EUR',               
    coinmarketcap: null,           
    showTimeSpent: true,           
    excludeContracts: [],          
    src: "./contracts"             
  }
};
