require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const { ethers } = require("ethers");
const { compileContract } = require("./compile-contract");

const ROOT_DIR = path.join(__dirname, "..");
const DEPLOYMENT_DIR = path.join(ROOT_DIR, "data", "deployments");
const DEPLOYMENT_PATH = path.join(DEPLOYMENT_DIR, "sepolia.json");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function deploy() {
  const rpcUrl = requiredEnv("SEPOLIA_RPC_URL");
  const privateKey = requiredEnv("SEPOLIA_PRIVATE_KEY");
  const artifact = await compileContract();
  const Provider = ethers.JsonRpcProvider || ethers.providers.JsonRpcProvider;
  const provider = new Provider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  console.log(`Deploying EEGRegistry from ${wallet.address}`);
  const contract = await factory.deploy();
  if (typeof contract.waitForDeployment === "function") {
    await contract.waitForDeployment();
  } else {
    await contract.deployed();
  }

  const address = typeof contract.getAddress === "function" ? await contract.getAddress() : contract.address;
  const deploymentTx = typeof contract.deploymentTransaction === "function"
    ? contract.deploymentTransaction()
    : contract.deployTransaction;
  const receipt = await deploymentTx.wait();
  const network = await provider.getNetwork();
  const deployment = {
    network: "sepolia",
    chainId: Number(network.chainId),
    contractName: artifact.contractName,
    contractAddress: address,
    deployer: wallet.address,
    txHash: receipt.hash || receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    deployedAt: new Date().toISOString()
  };

  await fs.mkdir(DEPLOYMENT_DIR, { recursive: true });
  await fs.writeFile(DEPLOYMENT_PATH, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");
  console.log(`EEGRegistry deployed to ${address}`);
  console.log(`Set EEG_REGISTRY_ADDRESS=${address}`);
  return deployment;
}

if (require.main === module) {
  deploy().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { deploy, DEPLOYMENT_PATH };
