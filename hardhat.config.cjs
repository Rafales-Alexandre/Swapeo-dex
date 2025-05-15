require("@nomicfoundation/hardhat-toolbox");
require("hardhat-gas-reporter");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545"
    },
  },
  gasReporter: {
    enabled: true,                 // active le gas reporter
    currency: 'EUR',               // ou 'USD', comme tu veux
    coinmarketcap: null,           // clé API pour prix réels (optionnel)
    showTimeSpent: true,           // affiche le temps d’exécution
    excludeContracts: [],          // à remplir si tu veux exclure certains contracts
    src: "./contracts"             // chemin des contrats
  }
};
