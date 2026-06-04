const crypto = require("node:crypto");

const GENESIS_RECEIPT_HASH = "0".repeat(64);

const MOCK_CHAIN = {
  schemaVersion: 1,
  chainId: 31337,
  networkName: "neuroproof-local-mock"
};

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function hashWithPrefix(value) {
  return `sha256:${sha256Hex(value)}`;
}

function hexFromSeed(seed, length) {
  let output = "";
  let counter = 0;
  while (output.length < length) {
    output += sha256Hex(`${seed}:${counter}`);
    counter += 1;
  }
  return output.slice(0, length);
}

function deriveMockAddress(seed) {
  return `0x${hexFromSeed(seed, 40)}`;
}

const MOCK_CONTRACT = {
  contractName: "EEGRegistry",
  contractAddress: deriveMockAddress("EEGRegistry:neuroproof-local-mock")
};

const EVENT_NAMES = {
  EEG_RECORD_REGISTERED: "EEGRecordRegistered",
  CONSENT_POLICY_CREATED: "ConsentPolicyCreated",
  CONSENT_POLICY_REVOKED: "ConsentPolicyRevoked",
  ACCESS_REQUEST_EVALUATED: "AccessRequestEvaluated",
  PROOF_CERTIFICATE_ISSUED: "ProofCertificateIssued"
};

const EVENT_SCHEMAS = {
  [EVENT_NAMES.EEG_RECORD_REGISTERED]: {
    signature: "EEGRecordRegistered(bytes32,bytes32,bytes32,bytes32,address,uint256)",
    required: ["recordId", "recordHash", "metadataHash", "ledgerBlockHash", "registeredBy", "registeredAt"]
  },
  [EVENT_NAMES.CONSENT_POLICY_CREATED]: {
    signature: "ConsentPolicyCreated(bytes32,bytes32,bytes32,bytes32,string[],uint256,address)",
    required: ["policyId", "recordId", "policyHash", "granteeHash", "allowedActions", "expiresAt", "createdBy"]
  },
  [EVENT_NAMES.CONSENT_POLICY_REVOKED]: {
    signature: "ConsentPolicyRevoked(bytes32,bytes32,address,uint256,bytes32)",
    required: ["policyId", "recordId", "revokedBy", "revokedAt", "reasonHash"]
  },
  [EVENT_NAMES.ACCESS_REQUEST_EVALUATED]: {
    signature: "AccessRequestEvaluated(bytes32,bytes32,bytes32,bytes32,string,address,uint256)",
    required: ["requestId", "recordId", "policyId", "requesterHash", "decision", "evaluatedBy", "evaluatedAt"]
  },
  [EVENT_NAMES.PROOF_CERTIFICATE_ISSUED]: {
    signature: "ProofCertificateIssued(bytes32,bytes32,bytes32,address,uint256)",
    required: ["proofId", "recordId", "certificateCoreHash", "issuedBy", "issuedAt"]
  }
};

const GAS_USED_BY_EVENT = {
  [EVENT_NAMES.EEG_RECORD_REGISTERED]: 74231,
  [EVENT_NAMES.CONSENT_POLICY_CREATED]: 68112,
  [EVENT_NAMES.CONSENT_POLICY_REVOKED]: 51280,
  [EVENT_NAMES.ACCESS_REQUEST_EVALUATED]: 59344,
  [EVENT_NAMES.PROOF_CERTIFICATE_ISSUED]: 54890
};

function deriveTxHash(receiptDraft) {
  return `0x${sha256Hex(canonicalize(receiptDraft))}`;
}

function deriveBlockHash(receiptDraft) {
  return `0x${sha256Hex(`block:${canonicalize(receiptDraft)}`)}`;
}

function hashedIdentity(value) {
  return hashWithPrefix(String(value || "anonymous").trim() || "anonymous");
}

function requiredEventSchema(eventName) {
  const schema = EVENT_SCHEMAS[eventName];
  if (!schema) {
    throw new Error(`Unknown blockchain event: ${eventName}`);
  }
  return schema;
}

function assertArgs(eventName, args) {
  const schema = requiredEventSchema(eventName);
  for (const field of schema.required) {
    if (args[field] === undefined || args[field] === null || args[field] === "") {
      throw new Error(`Missing blockchain event arg: ${field}`);
    }
  }
}

function buildEventArgs(eventName, input) {
  requiredEventSchema(eventName);

  if (eventName === EVENT_NAMES.EEG_RECORD_REGISTERED) {
    return {
      recordId: input.recordId,
      recordHash: hashWithPrefix(input.rawHash),
      metadataHash: hashWithPrefix(input.analysisHash),
      ledgerBlockHash: hashWithPrefix(input.ledgerBlockHash),
      registeredBy: deriveMockAddress(input.actor),
      registeredAt: input.timestamp
    };
  }

  if (eventName === EVENT_NAMES.CONSENT_POLICY_CREATED) {
    return {
      policyId: input.policyId,
      recordId: input.recordId,
      policyHash: input.policyHash,
      granteeHash: hashedIdentity(input.grantee),
      allowedActions: input.allowedActions,
      expiresAt: input.expiresAt,
      createdBy: deriveMockAddress(input.actor)
    };
  }

  if (eventName === EVENT_NAMES.CONSENT_POLICY_REVOKED) {
    return {
      policyId: input.policyId,
      recordId: input.recordId,
      revokedBy: deriveMockAddress(input.actor),
      revokedAt: input.revokedAt,
      reasonHash: hashWithPrefix(input.reason || "user-request")
    };
  }

  if (eventName === EVENT_NAMES.ACCESS_REQUEST_EVALUATED) {
    return {
      requestId: input.requestId,
      recordId: input.recordId,
      policyId: input.policyId || "none",
      requesterHash: hashedIdentity(input.requester),
      decision: input.decision,
      evaluatedBy: deriveMockAddress(input.actor || "system"),
      evaluatedAt: input.evaluatedAt
    };
  }

  return {
    proofId: input.proofId,
    recordId: input.recordId,
    certificateCoreHash: input.certificateCoreHash,
    issuedBy: deriveMockAddress(input.actor),
    issuedAt: input.issuedAt
  };
}

function hashReceipt(receipt) {
  const { receiptHash, ...receiptBase } = receipt;
  return hashWithPrefix(canonicalize(receiptBase));
}

function validateReceiptHash(receipt) {
  return Boolean(receipt && receipt.receiptHash === hashReceipt(receipt));
}

function validateReceiptChain(receipts) {
  let previousReceiptHash = GENESIS_RECEIPT_HASH;
  for (const receipt of receipts) {
    if (receipt.previousReceiptHash !== previousReceiptHash) {
      return false;
    }
    if (!validateReceiptHash(receipt)) {
      return false;
    }
    previousReceiptHash = receipt.receiptHash;
  }
  return true;
}

function createMockReceipt(input, context) {
  const eventName = input.eventName;
  const schema = requiredEventSchema(eventName);
  const args = input.args;
  assertArgs(eventName, args);

  const receiptDraft = {
    schemaVersion: MOCK_CHAIN.schemaVersion,
    chainId: MOCK_CHAIN.chainId,
    networkName: MOCK_CHAIN.networkName,
    blockNumber: context.blockNumber,
    transactionIndex: context.transactionIndex,
    logIndex: context.logIndex,
    contractAddress: MOCK_CONTRACT.contractAddress,
    contractName: MOCK_CONTRACT.contractName,
    eventName,
    eventSignature: schema.signature,
    status: "success",
    gasUsed: GAS_USED_BY_EVENT[eventName],
    recordId: input.recordId || null,
    policyId: input.policyId || null,
    accessRequestId: input.accessRequestId || null,
    proofId: input.proofId || null,
    linkedAuditEventHash: input.linkedAuditEventHash || null,
    actor: deriveMockAddress(input.actor || "system"),
    args,
    previousReceiptHash: context.previousReceiptHash,
    createdAt: context.createdAt
  };
  const withHashes = {
    ...receiptDraft,
    txHash: deriveTxHash(receiptDraft),
    blockHash: deriveBlockHash(receiptDraft)
  };
  return {
    ...withHashes,
    receiptHash: hashReceipt(withHashes)
  };
}

module.exports = {
  EVENT_NAMES,
  EVENT_SCHEMAS,
  GAS_USED_BY_EVENT,
  GENESIS_RECEIPT_HASH,
  MOCK_CHAIN,
  MOCK_CONTRACT,
  buildEventArgs,
  canonicalize,
  createMockReceipt,
  deriveMockAddress,
  deriveTxHash,
  hashReceipt,
  validateReceiptChain,
  validateReceiptHash
};
