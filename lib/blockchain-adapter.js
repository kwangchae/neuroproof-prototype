const crypto = require("node:crypto");
const {
  EVENT_NAMES,
  EVENT_SCHEMAS,
  MOCK_CHAIN,
  hashReceipt
} = require("./blockchain-receipts");

const EEG_REGISTRY_ABI = [
  "event EEGRecordRegistered(bytes32 indexed recordId, bytes32 recordHash, bytes32 metadataHash, bytes32 ledgerBlockHash, address indexed registeredBy, uint256 registeredAt)",
  "event ConsentPolicyCreated(bytes32 indexed policyId, bytes32 indexed recordId, bytes32 policyHash, bytes32 granteeHash, string[] allowedActions, uint256 expiresAt, address indexed createdBy)",
  "event ConsentPolicyRevoked(bytes32 indexed policyId, bytes32 indexed recordId, address indexed revokedBy, uint256 revokedAt, bytes32 reasonHash)",
  "event AccessRequestEvaluated(bytes32 indexed requestId, bytes32 indexed recordId, bytes32 policyId, bytes32 requesterHash, string decision, address indexed evaluatedBy, uint256 evaluatedAt)",
  "event ProofCertificateIssued(bytes32 indexed proofId, bytes32 indexed recordId, bytes32 certificateCoreHash, address indexed issuedBy, uint256 issuedAt)",
  "function registerRecord(bytes32 recordId, bytes32 recordHash, bytes32 metadataHash, bytes32 ledgerBlockHash) external",
  "function createConsentPolicy(bytes32 policyId, bytes32 recordId, bytes32 policyHash, bytes32 granteeHash, string[] allowedActions, uint256 expiresAt) external",
  "function revokeConsentPolicy(bytes32 policyId, bytes32 recordId, bytes32 reasonHash) external",
  "function evaluateAccessRequest(bytes32 requestId, bytes32 recordId, bytes32 policyId, bytes32 requesterHash, string decision) external",
  "function issueProofCertificate(bytes32 proofId, bytes32 recordId, bytes32 certificateCoreHash) external"
];

function normalizeChainProvider(value) {
  return String(value || "mock").trim().toLowerCase();
}

function blockchainStatusFromEnv(env = process.env) {
  const provider = normalizeChainProvider(env.CHAIN_PROVIDER || env.BLOCKCHAIN_PROVIDER);
  const sepoliaConfigured = Boolean(
    env.SEPOLIA_RPC_URL &&
    env.SEPOLIA_PRIVATE_KEY &&
    env.EEG_REGISTRY_ADDRESS
  );

  return {
    provider,
    mode: provider === "sepolia" ? "real-testnet" : "mock-chain",
    configured: provider === "sepolia" ? sepoliaConfigured : true,
    networkName: provider === "sepolia" ? "sepolia" : MOCK_CHAIN.networkName,
    contractAddress: provider === "sepolia" ? env.EEG_REGISTRY_ADDRESS || null : null
  };
}

function assertSepoliaConfig(env) {
  const missing = [
    "SEPOLIA_RPC_URL",
    "SEPOLIA_PRIVATE_KEY",
    "EEG_REGISTRY_ADDRESS"
  ].filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Sepolia blockchain is not configured. Missing: ${missing.join(", ")}`);
  }
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function toBytes32(value) {
  const normalized = String(value || "").trim();

  if (/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    return normalized.toLowerCase();
  }

  if (/^[a-fA-F0-9]{64}$/.test(normalized)) {
    return `0x${normalized.toLowerCase()}`;
  }

  if (normalized.startsWith("sha256:")) {
    const hex = normalized.slice("sha256:".length);
    if (/^[a-fA-F0-9]{64}$/.test(hex)) {
      return `0x${hex.toLowerCase()}`;
    }
  }

  return `0x${sha256Hex(normalized)}`;
}

function toUnixTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }

  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return 0;
  }
  return Math.floor(time / 1000);
}

function firstLogIndex(txReceipt, contractAddress) {
  const target = String(contractAddress || "").toLowerCase();
  const logs = Array.isArray(txReceipt.logs) ? txReceipt.logs : [];
  const match = logs.find((log) => String(log.address || "").toLowerCase() === target);
  const index = match && (match.index ?? match.logIndex);
  return index !== undefined ? Number(index) : 0;
}

function toSafeNumber(value) {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "object" && typeof value.toString === "function") {
    return Number(value.toString());
  }
  return Number(value);
}

function buildRealReceiptFromTransaction(input, context, txReceipt, network) {
  const eventSignature = EVENT_SCHEMAS[input.eventName].signature;
  const receiptBase = {
    schemaVersion: MOCK_CHAIN.schemaVersion,
    chainId: toSafeNumber(network.chainId),
    networkName: network.networkName,
    blockNumber: toSafeNumber(txReceipt.blockNumber),
    transactionIndex: toSafeNumber(txReceipt.index ?? txReceipt.transactionIndex ?? 0),
    logIndex: firstLogIndex(txReceipt, context.contractAddress),
    contractAddress: context.contractAddress,
    contractName: "EEGRegistry",
    eventName: input.eventName,
    eventSignature,
    status: txReceipt.status === 1 || txReceipt.status === "success" ? "success" : "failed",
    gasUsed: toSafeNumber(txReceipt.gasUsed),
    recordId: input.recordId || null,
    policyId: input.policyId || null,
    accessRequestId: input.accessRequestId || null,
    proofId: input.proofId || null,
    linkedAuditEventHash: input.linkedAuditEventHash || null,
    actor: context.actorAddress,
    args: input.args,
    previousReceiptHash: context.previousReceiptHash,
    createdAt: context.createdAt,
    txHash: txReceipt.hash || txReceipt.transactionHash,
    blockHash: txReceipt.blockHash
  };

  return {
    ...receiptBase,
    receiptHash: hashReceipt(receiptBase)
  };
}

async function sendContractTransaction(contract, input) {
  const args = input.args;

  if (input.eventName === EVENT_NAMES.EEG_RECORD_REGISTERED) {
    return contract.registerRecord(
      toBytes32(args.recordId),
      toBytes32(args.recordHash),
      toBytes32(args.metadataHash),
      toBytes32(args.ledgerBlockHash)
    );
  }

  if (input.eventName === EVENT_NAMES.CONSENT_POLICY_CREATED) {
    return contract.createConsentPolicy(
      toBytes32(args.policyId),
      toBytes32(args.recordId),
      toBytes32(args.policyHash),
      toBytes32(args.granteeHash),
      args.allowedActions || [],
      toUnixTimestamp(args.expiresAt)
    );
  }

  if (input.eventName === EVENT_NAMES.CONSENT_POLICY_REVOKED) {
    return contract.revokeConsentPolicy(
      toBytes32(args.policyId),
      toBytes32(args.recordId),
      toBytes32(args.reasonHash)
    );
  }

  if (input.eventName === EVENT_NAMES.ACCESS_REQUEST_EVALUATED) {
    return contract.evaluateAccessRequest(
      toBytes32(args.requestId),
      toBytes32(args.recordId),
      toBytes32(args.policyId),
      toBytes32(args.requesterHash),
      args.decision
    );
  }

  return contract.issueProofCertificate(
    toBytes32(args.proofId),
    toBytes32(args.recordId),
    toBytes32(args.certificateCoreHash)
  );
}

function createSepoliaBlockchainAdapter({ env = process.env }) {
  assertSepoliaConfig(env);

  let contract = null;
  let wallet = null;

  async function getContract() {
    if (!contract) {
      const { ethers } = require("ethers");
      const Provider = ethers.JsonRpcProvider || ethers.providers.JsonRpcProvider;
      const provider = new Provider(env.SEPOLIA_RPC_URL);
      wallet = new ethers.Wallet(env.SEPOLIA_PRIVATE_KEY, provider);
      contract = new ethers.Contract(env.EEG_REGISTRY_ADDRESS, EEG_REGISTRY_ABI, wallet);
    }
    return contract;
  }

  return {
    provider: "sepolia",
    async createReceipt(input, context) {
      const registry = await getContract();
      const tx = await sendContractTransaction(registry, input);
      const txReceipt = await tx.wait();
      const network = await wallet.provider.getNetwork();

      return buildRealReceiptFromTransaction(input, {
        ...context,
        actorAddress: wallet.address,
        contractAddress: env.EEG_REGISTRY_ADDRESS
      }, txReceipt, {
        chainId: network.chainId,
        networkName: "sepolia"
      });
    }
  };
}

function createBlockchainAdapter({ env = process.env }) {
  const provider = normalizeChainProvider(env.CHAIN_PROVIDER || env.BLOCKCHAIN_PROVIDER);

  if (provider === "sepolia") {
    return createSepoliaBlockchainAdapter({ env });
  }

  if (provider !== "mock") {
    throw new Error(`Unsupported blockchain provider: ${provider}`);
  }

  return { provider: "mock" };
}

module.exports = {
  EEG_REGISTRY_ABI,
  blockchainStatusFromEnv,
  buildRealReceiptFromTransaction,
  createBlockchainAdapter,
  createSepoliaBlockchainAdapter,
  normalizeChainProvider,
  toBytes32,
  toUnixTimestamp
};
