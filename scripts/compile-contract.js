const fs = require("node:fs/promises");
const path = require("node:path");
const solc = require("solc");

const ROOT_DIR = path.join(__dirname, "..");
const CONTRACT_PATH = path.join(ROOT_DIR, "contracts", "EEGRegistry.sol");
const ARTIFACT_DIR = path.join(ROOT_DIR, "artifacts", "contracts");
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, "EEGRegistry.json");

async function compileContract() {
  const source = await fs.readFile(CONTRACT_PATH, "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "EEGRegistry.sol": { content: source }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"]
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors || [];
  const failures = errors.filter((error) => error.severity === "error");
  for (const error of errors) {
    const stream = error.severity === "error" ? process.stderr : process.stdout;
    stream.write(`${error.formattedMessage}\n`);
  }

  if (failures.length > 0) {
    throw new Error("Solidity compilation failed.");
  }

  const contract = output.contracts["EEGRegistry.sol"].EEGRegistry;
  const artifact = {
    contractName: "EEGRegistry",
    sourceName: "contracts/EEGRegistry.sol",
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`
  };

  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

if (require.main === module) {
  compileContract()
    .then((artifact) => {
      console.log(`Compiled ${artifact.contractName} -> ${path.relative(ROOT_DIR, ARTIFACT_PATH)}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { compileContract, ARTIFACT_PATH };
