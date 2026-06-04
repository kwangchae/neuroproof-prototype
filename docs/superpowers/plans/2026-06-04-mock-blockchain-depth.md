# Mock Blockchain Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local mock blockchain receipt layer that makes NeuroProof's blockchain side look like smart-contract-compatible event receipts while keeping the demo offline and stable.

**Architecture:** Add a pure receipt module for Ethereum-looking hashes, event schemas, receipt hash validation, and receipt-chain validation. Store receipts oldest-first in `data/blockchain-receipts.json`, return newest-first from APIs/UI, link receipts to audit events and proof certificates, and render them in Admin as `스마트컨트랙트 이벤트`.

**Tech Stack:** Node.js built-in `crypto`, `fs/promises`, `http`; JSON local stores; existing static browser UI; Node test runner.

---

## File Structure

- Create: `lib/blockchain-receipts.js`  
  Pure logic only. Builds event args and mock receipts, derives Ethereum-looking hashes/addresses, validates receipt hashes and receipt-chain continuity.

- Modify: `test/server.test.js`  
  Add unit tests for receipt construction, invalid events, tamper detection, chain validation, API helper behavior, and proof receipt shape.

- Modify: `server.js`  
  Add receipt JSON path, append/read/filter helpers, wire receipt creation into record/policy/access/proof actions, expose `/api/blockchain-receipts`, and include `blockchainReceipts` in `/api/records`.

- Modify: `public/index.html`  
  Add Admin panel `스마트컨트랙트 이벤트` before `블록체인형 원장`.

- Modify: `public/app.js`  
  Add receipt state, render receipts newest-first, show validation status, use truncated hashes, and include receipt count in metrics.

- Modify: `public/styles.css`  
  Style receipt rows consistently with current panels and prevent hash overflow.

- Modify: `README.md`  
  Document local mock chain, off-chain EEG, event receipts, and Sepolia migration path.

---

### Task 1: Add Pure Mock Receipt Module

**Files:**
- Create: `lib/blockchain-receipts.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Add failing receipt module imports and tests**

Add this import near the other `lib` imports in `test/server.test.js`:

```js
const {
  EVENT_NAMES,
  buildEventArgs,
  createMockReceipt,
  deriveMockAddress,
  validateReceiptChain,
  validateReceiptHash
} = require("../lib/blockchain-receipts");
```

Add these tests after the existing secret-sharing test:

```js
test("createMockReceipt builds Ethereum-looking receipt fields", () => {
  const args = buildEventArgs(EVENT_NAMES.EEG_RECORD_REGISTERED, {
    recordId: "record-1",
    rawHash: "raw-hash",
    analysisHash: "analysis-hash",
    ledgerBlockHash: "ledger-block-hash",
    actor: "demo-user",
    timestamp: "2026-06-04T00:00:00.000Z"
  });
  const receipt = createMockReceipt({
    eventName: EVENT_NAMES.EEG_RECORD_REGISTERED,
    recordId: "record-1",
    actor: "demo-user",
    args,
    linkedAuditEventHash: "audit-hash"
  }, {
    previousReceiptHash: "0".repeat(64),
    blockNumber: 1,
    transactionIndex: 0,
    logIndex: 0,
    createdAt: "2026-06-04T00:00:00.000Z"
  });

  assert.match(receipt.txHash, /^0x[a-f0-9]{64}$/);
  assert.match(receipt.blockHash, /^0x[a-f0-9]{64}$/);
  assert.match(receipt.contractAddress, /^0x[a-f0-9]{40}$/);
  assert.equal(receipt.eventName, "EEGRecordRegistered");
  assert.equal(receipt.chainId, 31337);
  assert.equal(receipt.args.recordId, "record-1");
  assert.equal(validateReceiptHash(receipt), true);
});

test("mock receipt validation rejects tampering and invalid chains", () => {
  const first = createMockReceipt({
    eventName: EVENT_NAMES.CONSENT_POLICY_CREATED,
    recordId: "record-1",
    policyId: "policy-1",
    actor: "demo-user",
    args: buildEventArgs(EVENT_NAMES.CONSENT_POLICY_CREATED, {
      policyId: "policy-1",
      recordId: "record-1",
      policyHash: "policy-hash",
      grantee: "research-admin",
      allowedActions: ["derived-summary"],
      expiresAt: "2026-12-31T00:00:00.000Z",
      actor: "demo-user"
    }),
    linkedAuditEventHash: "audit-1"
  }, {
    previousReceiptHash: "0".repeat(64),
    blockNumber: 1,
    transactionIndex: 0,
    logIndex: 0,
    createdAt: "2026-06-04T00:00:00.000Z"
  });
  const second = createMockReceipt({
    eventName: EVENT_NAMES.CONSENT_POLICY_REVOKED,
    recordId: "record-1",
    policyId: "policy-1",
    actor: "demo-user",
    args: buildEventArgs(EVENT_NAMES.CONSENT_POLICY_REVOKED, {
      policyId: "policy-1",
      recordId: "record-1",
      actor: "demo-user",
      revokedAt: "2026-06-05T00:00:00.000Z",
      reason: "user-request"
    }),
    linkedAuditEventHash: "audit-2"
  }, {
    previousReceiptHash: first.receiptHash,
    blockNumber: 2,
    transactionIndex: 0,
    logIndex: 0,
    createdAt: "2026-06-05T00:00:00.000Z"
  });

  assert.equal(validateReceiptHash({ ...first, eventName: "Changed" }), false);
  assert.equal(validateReceiptChain([first, second]), true);
  assert.equal(validateReceiptChain([second, first]), false);
  assert.equal(validateReceiptChain([first, { ...second, previousReceiptHash: "wrong" }]), false);
});

test("mock receipt helpers reject unknown events and hash identities", () => {
  assert.throws(() => buildEventArgs("UnknownEvent", {}), /Unknown blockchain event/);
  assert.match(deriveMockAddress("demo-user"), /^0x[a-f0-9]{40}$/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test
```

Expected: FAIL with `Cannot find module '../lib/blockchain-receipts'`.

- [ ] **Step 3: Create `lib/blockchain-receipts.js`**

Create the file with:

```js
const crypto = require("node:crypto");

const GENESIS_RECEIPT_HASH = "0".repeat(64);

const MOCK_CHAIN = {
  schemaVersion: 1,
  chainId: 31337,
  networkName: "neuroproof-local-mock"
};

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
    signature: "EEGRecordRegistered(bytes32,bytes32,bytes32,address,uint256)",
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
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```powershell
npm test
```

Expected: PASS for existing tests plus the new receipt module tests.

- [ ] **Step 5: Checkpoint**

Run:

```powershell
git diff -- lib/blockchain-receipts.js test/server.test.js
```

Expected: only Task 1 files changed. Commit only if the user explicitly requests commits in this workspace.

---

### Task 2: Add Server Receipt Storage, Filtering, And API

**Files:**
- Modify: `server.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Add failing tests for receipt filtering and newest-first API shape helpers**

Update the `require("../server")` destructuring in `test/server.test.js` to include:

```js
filterBlockchainReceipts,
withReceiptValidation
```

Add this test near the receipt tests:

```js
test("filterBlockchainReceipts returns newest-first derived validation", () => {
  const first = createMockReceipt({
    eventName: EVENT_NAMES.EEG_RECORD_REGISTERED,
    recordId: "record-1",
    actor: "demo-user",
    args: buildEventArgs(EVENT_NAMES.EEG_RECORD_REGISTERED, {
      recordId: "record-1",
      rawHash: "raw",
      analysisHash: "analysis",
      ledgerBlockHash: "block",
      actor: "demo-user",
      timestamp: "2026-06-04T00:00:00.000Z"
    }),
    linkedAuditEventHash: "audit-1"
  }, {
    previousReceiptHash: "0".repeat(64),
    blockNumber: 1,
    transactionIndex: 0,
    logIndex: 0,
    createdAt: "2026-06-04T00:00:00.000Z"
  });
  const second = createMockReceipt({
    eventName: EVENT_NAMES.ACCESS_REQUEST_EVALUATED,
    recordId: "record-1",
    accessRequestId: "request-1",
    actor: "research-admin",
    args: buildEventArgs(EVENT_NAMES.ACCESS_REQUEST_EVALUATED, {
      requestId: "request-1",
      recordId: "record-1",
      policyId: "policy-1",
      requester: "research-admin",
      decision: "approved",
      actor: "system",
      evaluatedAt: "2026-06-04T00:01:00.000Z"
    }),
    linkedAuditEventHash: "audit-2"
  }, {
    previousReceiptHash: first.receiptHash,
    blockNumber: 2,
    transactionIndex: 0,
    logIndex: 0,
    createdAt: "2026-06-04T00:01:00.000Z"
  });

  const filtered = filterBlockchainReceipts([first, second], { recordId: "record-1", limit: 1 });
  const validated = withReceiptValidation([first, second]);

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].txHash, second.txHash);
  assert.equal(validated.every((receipt) => receipt.isValid === true), true);
  assert.equal(validated[0].isChainValid, true);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test
```

Expected: FAIL because `filterBlockchainReceipts` and `withReceiptValidation` are not exported.

- [ ] **Step 3: Add imports, path, and helper functions in `server.js`**

At the top of `server.js`, add:

```js
const {
  EVENT_NAMES,
  buildEventArgs,
  createMockReceipt,
  validateReceiptChain,
  validateReceiptHash
} = require("./lib/blockchain-receipts");
```

Near other data paths, add:

```js
const BLOCKCHAIN_RECEIPTS_PATH = path.join(DATA_DIR, "blockchain-receipts.json");
```

After `writeJson`, add an atomic JSON writer used for receipt storage:

```js
async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}
```

Add these pure helpers near other validation helpers:

```js
function withReceiptValidation(receipts) {
  const chainValid = validateReceiptChain(receipts);
  return receipts.map((receipt) => ({
    ...receipt,
    isValid: validateReceiptHash(receipt),
    isChainValid: chainValid
  }));
}

function filterBlockchainReceipts(receipts, filters = {}) {
  let result = [...receipts].reverse();
  if (filters.recordId) {
    result = result.filter((receipt) => receipt.recordId === filters.recordId);
  }
  if (filters.eventName) {
    result = result.filter((receipt) => receipt.eventName === filters.eventName);
  }
  if (filters.limit) {
    result = result.slice(0, Number(filters.limit));
  }
  return result;
}
```

Add async helpers after `appendAuditEvent`:

```js
async function readBlockchainReceipts() {
  return readJson(BLOCKCHAIN_RECEIPTS_PATH, []);
}

async function appendBlockchainReceipt({ eventName, recordId, policyId, accessRequestId, proofId, actor, args, linkedAuditEventHash }) {
  await ensureDataDirs();
  const receipts = await readBlockchainReceipts();
  const previousReceiptHash = receipts.length > 0 ? receipts[receipts.length - 1].receiptHash : "0".repeat(64);
  const receipt = createMockReceipt({
    eventName,
    recordId,
    policyId,
    accessRequestId,
    proofId,
    actor,
    args,
    linkedAuditEventHash
  }, {
    previousReceiptHash,
    blockNumber: receipts.length + 1,
    transactionIndex: 0,
    logIndex: 0,
    createdAt: new Date().toISOString()
  });
  const nextReceipts = [...receipts, receipt];
  if (!validateReceiptChain(nextReceipts)) {
    throw new Error("Blockchain receipt chain validation failed.");
  }
  await writeJsonAtomic(BLOCKCHAIN_RECEIPTS_PATH, nextReceipts);
  return receipt;
}

async function latestReceiptForRecord(recordId, eventName) {
  const receipts = await readBlockchainReceipts();
  return [...receipts]
    .reverse()
    .find((receipt) => receipt.recordId === recordId && (!eventName || receipt.eventName === eventName)) || null;
}
```

- [ ] **Step 4: Extend API responses and route**

In `GET /api/records`, read and return receipts:

```js
const blockchainReceipts = await readBlockchainReceipts();
const validatedReceipts = withReceiptValidation(blockchainReceipts);
sendJson(response, 200, {
  records: recordsWithRiskLabels,
  ledger,
  auditLog,
  accessGrants,
  consentPolicies,
  accessRequests,
  blockchainReceipts: filterBlockchainReceipts(validatedReceipts),
  blockchainReceiptChainValid: validateReceiptChain(blockchainReceipts),
  ledgerValid: validateLedger(ledger),
  auditLogValid: validateAuditLog(auditLog)
});
```

Add this route before static file serving:

```js
if (request.method === "GET" && url.pathname === "/api/blockchain-receipts") {
  const receipts = await readBlockchainReceipts();
  sendJson(response, 200, {
    blockchainReceipts: filterBlockchainReceipts(withReceiptValidation(receipts), {
      recordId: url.searchParams.get("recordId"),
      eventName: url.searchParams.get("eventName"),
      limit: url.searchParams.get("limit")
    }),
    chainValid: validateReceiptChain(receipts)
  });
  return;
}
```

Export the helpers:

```js
filterBlockchainReceipts,
withReceiptValidation
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run:

```powershell
git diff -- server.js test/server.test.js
```

Expected: API and helper changes only. Commit only if the user explicitly requests commits in this workspace.

---

### Task 3: Wire Receipts Into Domain Actions And Proofs

**Files:**
- Modify: `server.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Add failing proof core hash test**

Update `require("../server")` destructuring to include:

```js
buildProofCore,
certificateCoreHash
```

Add this test near the existing proof certificate test:

```js
test("certificateCoreHash excludes transactionReceipt to avoid circular hashes", () => {
  const analysis = analyzeEegCsv(sample);
  const block = buildLedgerBlock({
    ledger: [],
    recordId: "record-1",
    owner: "demo-user",
    rawHash: sha256Hex(sample),
    analysisHash: sha256Hex(stableStringify(analysis)),
    objectKey: "record-1.csv",
    timestamp: "2026-06-02T00:00:00.000Z"
  });
  const record = {
    recordId: "record-1",
    fileName: "eeg-sample.csv",
    owner: "demo-user",
    timestamp: block.timestamp,
    rawHash: block.rawHash,
    analysisHash: block.analysisHash,
    blockHash: block.blockHash,
    analysis,
    riskLabels: riskLabelsForAnalysis(analysis)
  };
  const core = buildProofCore({
    record,
    block,
    generatedAt: "2026-06-02T00:00:01.000Z"
  });
  const fullProof = { ...core, transactionReceipt: { txHash: "0xabc" } };

  assert.equal(certificateCoreHash(core), certificateCoreHash(fullProof));
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test
```

Expected: FAIL because `buildProofCore` and `certificateCoreHash` are missing.

- [ ] **Step 3: Split proof core from receipt attachment**

Rename the current `buildProofCertificate` body into `buildProofCore`:

```js
function buildProofCore({ record, block, generatedAt }) {
  return {
    proofType: "NeuroProof EEG Integrity Certificate",
    proofVersion: "1.0",
    generatedAt,
    record: {
      recordId: record.recordId,
      fileName: record.fileName,
      owner: record.owner,
      timestamp: record.timestamp,
      rowCount: record.analysis.rowCount,
      channelCount: record.analysis.channelCount
    },
    hashes: {
      rawHash: record.rawHash,
      analysisHash: record.analysisHash,
      blockHash: record.blockHash,
      previousHash: block.previousHash
    },
    ledger: {
      blockIndex: block.index,
      ledgerValidAtIssueTime: true
    },
    privacy: {
      rawDataLocation: "off-chain",
      onChainData: "hashes_and_events_only",
      userRights: [
        "verify_record_integrity",
        "download_receipt",
        "grant_access",
        "revoke_access",
        "inspect_audit_log"
      ],
      riskSummary: record.riskLabels || riskLabelsForAnalysis(record.analysis)
    },
    verification: {
      method: "Recalculate SHA-256 for the EEG file and compare it with rawHash.",
      resultHashMethod: "Recalculate SHA-256 for the stable JSON analysis result and compare it with analysisHash."
    }
  };
}

function certificateCoreHash(proofOrCore) {
  const { transactionReceipt, ...core } = proofOrCore;
  return `sha256:${sha256Hex(stableStringify(core))}`;
}

function buildProofCertificate({ record, block, generatedAt, transactionReceipt = null }) {
  return {
    ...buildProofCore({ record, block, generatedAt }),
    transactionReceipt
  };
}
```

Export:

```js
buildProofCore,
certificateCoreHash
```

- [ ] **Step 4: Append receipts for create/update actions**

For each domain action, capture the audit return value and append a receipt.

In `createRecord`, replace the existing upload audit append with:

```js
const auditResult = await appendAuditEvent({
  actor: block.owner,
  action: "upload_record",
  recordId,
  details: {
    fileName: safeFileName,
    rawHash,
    blockHash: block.blockHash
  }
});
await appendBlockchainReceipt({
  eventName: EVENT_NAMES.EEG_RECORD_REGISTERED,
  recordId,
  actor: block.owner,
  args: buildEventArgs(EVENT_NAMES.EEG_RECORD_REGISTERED, {
    recordId,
    rawHash,
    analysisHash,
    ledgerBlockHash: block.blockHash,
    actor: block.owner,
    timestamp
  }),
  linkedAuditEventHash: auditResult.entry.eventHash
});
```

In `createConsentPolicy`, after the audit event:

```js
const auditResult = await appendAuditEvent({
  actor: request.actor || result.policy.owner,
  action: "create_consent_policy",
  recordId: result.policy.recordId,
  details: {
    policyId: result.policy.policyId,
    recipient: result.policy.recipient,
    purpose: result.policy.purpose,
    dataScope: result.policy.dataScope,
    policyHash: result.policy.policyHash
  }
});
await appendBlockchainReceipt({
  eventName: EVENT_NAMES.CONSENT_POLICY_CREATED,
  recordId: result.policy.recordId,
  policyId: result.policy.policyId,
  actor: request.actor || result.policy.owner,
  args: buildEventArgs(EVENT_NAMES.CONSENT_POLICY_CREATED, {
    policyId: result.policy.policyId,
    recordId: result.policy.recordId,
    policyHash: result.policy.policyHash,
    grantee: result.policy.recipient,
    allowedActions: [result.policy.dataScope],
    expiresAt: result.policy.expiresAt,
    actor: request.actor || result.policy.owner
  }),
  linkedAuditEventHash: auditResult.entry.eventHash
});
```

In `revokeConsentPolicy`, after the audit event:

```js
const revokedAt = new Date().toISOString();
const revokedPolicy = buildConsentPolicy({
  ...currentPolicy,
  status: "revoked",
  revokedAt
});
const auditResult = await appendAuditEvent({
  actor: actor || currentPolicy.owner,
  action: "revoke_consent_policy",
  recordId: currentPolicy.recordId,
  details: {
    policyId: currentPolicy.policyId,
    recipient: currentPolicy.recipient,
    purpose: currentPolicy.purpose,
    policyHash: revokedPolicy.policyHash
  }
});
await appendBlockchainReceipt({
  eventName: EVENT_NAMES.CONSENT_POLICY_REVOKED,
  recordId: currentPolicy.recordId,
  policyId: currentPolicy.policyId,
  actor: actor || currentPolicy.owner,
  args: buildEventArgs(EVENT_NAMES.CONSENT_POLICY_REVOKED, {
    policyId: currentPolicy.policyId,
    recordId: currentPolicy.recordId,
    actor: actor || currentPolicy.owner,
    revokedAt,
    reason: "user-request"
  }),
  linkedAuditEventHash: auditResult.entry.eventHash
});
```

In `createAccessRequest`, after the audit event:

```js
const auditResult = await appendAuditEvent({
  actor: request.recipient || "research-admin",
  action: "evaluate_access_request",
  recordId: accessRequest.recordId,
  details: {
    requestId: accessRequest.requestId,
    policyId: accessRequest.policyId,
    purpose: accessRequest.purpose,
    dataScope: accessRequest.dataScope,
    decision: accessRequest.decision,
    reason: accessRequest.reason,
    requestHash: accessRequest.requestHash
  }
});
await appendBlockchainReceipt({
  eventName: EVENT_NAMES.ACCESS_REQUEST_EVALUATED,
  recordId: accessRequest.recordId,
  accessRequestId: accessRequest.requestId,
  actor: request.recipient || "research-admin",
  args: buildEventArgs(EVENT_NAMES.ACCESS_REQUEST_EVALUATED, {
    requestId: accessRequest.requestId,
    recordId: accessRequest.recordId,
    policyId: accessRequest.policyId,
    requester: accessRequest.recipient,
    decision: accessRequest.decision,
    actor: "system",
    evaluatedAt: accessRequest.requestedAt
  }),
  linkedAuditEventHash: auditResult.entry.eventHash
});
```

- [ ] **Step 5: Make proof receipt idempotent**

In `readProofCertificate`, after `core` is built and before returning proof:

```js
const generatedAt = new Date().toISOString();
const core = buildProofCore({ record, block, generatedAt });
const coreHash = certificateCoreHash(core);
const existingReceipt = (await readBlockchainReceipts())
  .find((receipt) =>
    receipt.eventName === EVENT_NAMES.PROOF_CERTIFICATE_ISSUED &&
    receipt.recordId === recordId &&
    receipt.args.certificateCoreHash === coreHash
  );
let transactionReceipt = existingReceipt || null;

if (!transactionReceipt) {
  const auditResult = await appendAuditEvent({
    actor,
    action: "issue_proof",
    recordId,
    details: {
      proofType: core.proofType,
      blockHash: core.hashes.blockHash,
      certificateCoreHash: coreHash
    }
  });
  transactionReceipt = await appendBlockchainReceipt({
    eventName: EVENT_NAMES.PROOF_CERTIFICATE_ISSUED,
    recordId,
    proofId: `${recordId}:${coreHash}`,
    actor,
    args: buildEventArgs(EVENT_NAMES.PROOF_CERTIFICATE_ISSUED, {
      proofId: `${recordId}:${coreHash}`,
      recordId,
      certificateCoreHash: coreHash,
      actor,
      issuedAt: generatedAt
    }),
    linkedAuditEventHash: auditResult.entry.eventHash
  });
}

return {
  ...core,
  transactionReceipt
};
```

This replaces the previous unconditional `appendAuditEvent` in `readProofCertificate`.

- [ ] **Step 6: Run tests to verify pass**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 7: API smoke test receipts**

Run with the server running:

```powershell
$base = 'http://localhost:3000'
$sample = Get-Content -Path sample\eeg-sample.csv -Raw
$created = Invoke-RestMethod "$base/api/records" -Method Post -ContentType 'application/json' -Body (@{ fileName = 'eeg-sample.csv'; owner = 'demo-user'; content = $sample } | ConvertTo-Json -Depth 5)
$recordId = $created.record.recordId
$proof = Invoke-RestMethod "$base/api/proofs/$recordId"
$receipts = Invoke-RestMethod "$base/api/blockchain-receipts?recordId=$recordId"
[pscustomobject]@{
  hasReceipt = [bool]$proof.transactionReceipt
  eventNames = ($receipts.blockchainReceipts | Select-Object -ExpandProperty eventName) -join ','
  chainValid = $receipts.chainValid
} | ConvertTo-Json
```

Expected JSON includes `hasReceipt: true`, `EEGRecordRegistered`, `ProofCertificateIssued`, and `chainValid: true`.

- [ ] **Step 8: Checkpoint**

Run:

```powershell
git diff -- server.js test/server.test.js
```

Expected: domain integration only. Commit only if the user explicitly requests commits in this workspace.

---

### Task 4: Add Admin Smart Contract Event UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Add HTML panel**

In `public/index.html`, add this panel immediately before the `블록체인형 원장` panel:

```html
<section class="panel wide">
  <div class="sectionHeader">
    <h2>스마트컨트랙트 이벤트</h2>
    <span class="hint">Local Mock Chain · EEGRegistry-compatible receipts</span>
  </div>
  <div id="blockchainReceipts" class="blockchainReceipts"></div>
</section>
```

- [ ] **Step 2: Add app state and render function**

In `public/app.js`, add selector and state near related Admin values:

```js
const blockchainReceiptsEl = document.querySelector("#blockchainReceipts");
let blockchainReceipts = [];
```

Add helper:

```js
function statusLabel(receipt) {
  if (!receipt.isValid || !receipt.isChainValid) {
    return "변조 의심";
  }
  return receipt.status === "success" ? "검증됨" : receipt.status;
}
```

Add renderer near other Admin renderers:

```js
function renderBlockchainReceipts() {
  blockchainReceiptsEl.innerHTML = "";

  if (blockchainReceipts.length === 0) {
    blockchainReceiptsEl.innerHTML = "<p class=\"empty\">아직 스마트컨트랙트 이벤트가 없습니다.</p>";
    return;
  }

  for (const receipt of blockchainReceipts) {
    const valid = receipt.isValid && receipt.isChainValid;
    const item = document.createElement("article");
    item.className = `receiptItem ${valid ? "validReceipt" : "invalidReceipt"}`;
    item.innerHTML = `
      <div>
        <h3>${receipt.eventName}</h3>
        <p>${statusLabel(receipt)} / Block #${receipt.blockNumber} / Gas ${Number(receipt.gasUsed).toLocaleString()}</p>
      </div>
      <div class="hashes">
        <span>Tx ${shortHash(receipt.txHash)}</span>
        <span>Record ${receipt.recordId || "-"}</span>
        <span>Audit ${receipt.linkedAuditEventHash ? shortHash(receipt.linkedAuditEventHash) : "-"}</span>
        <span>Receipt ${shortHash(receipt.receiptHash)}</span>
      </div>
      <details class="receiptArgs">
        <summary>Args</summary>
        <pre>${JSON.stringify(receipt.args, null, 2)}</pre>
      </details>
    `;
    blockchainReceiptsEl.append(item);
  }
}
```

In `renderSystemMetrics`, add:

```js
<div><span>Contract Events</span><strong>${blockchainReceipts.length}</strong></div>
```

In `loadRecords`, store and render:

```js
blockchainReceipts = data.blockchainReceipts || [];
renderLedgerStatus(data.ledgerValid);
renderAuditStatus(data.auditLogValid);
renderRecords();
renderRecordDetail();
renderLedgerBlocks();
renderSystemMetrics(data);
renderGovernanceSummary(data);
renderAccessGrants();
renderConsentPolicies();
renderAccessRequests();
renderBlockchainReceipts();
renderAuditEvents();
```

- [ ] **Step 3: Add CSS**

In `public/styles.css`, extend list styles:

```css
.blockchainReceipts {
  display: grid;
  gap: 12px;
}

.receiptItem {
  display: grid;
  grid-template-columns: minmax(190px, 0.8fr) minmax(300px, 1fr) minmax(260px, 0.8fr);
  gap: 16px;
  align-items: start;
  border-top: 1px solid #e3e8eb;
  padding: 16px 0 4px;
}

.receiptItem p {
  margin-bottom: 0;
  color: #66757f;
}

.validReceipt {
  border-top-color: #9dd4b4;
}

.invalidReceipt {
  border-top-color: #e0a4a4;
}

.receiptArgs summary {
  cursor: pointer;
  color: #176b87;
  font-weight: 800;
}

.receiptArgs pre {
  max-height: 180px;
  overflow: auto;
  border: 1px solid #d9e0e4;
  border-radius: 8px;
  padding: 10px;
  background: #fbfcfc;
  color: #40505a;
  font-family: "Cascadia Mono", Consolas, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

In the mobile media query, include:

```css
.receiptItem
```

in the single-column selector list.

- [ ] **Step 4: Browser check**

With the server running, open:

```text
http://localhost:3000/
```

Verify:

- Admin has `스마트컨트랙트 이벤트`
- event rows show event name, status, tx, block, gas, receipt hash
- Args opens without horizontal overflow
- Browser console has no errors

- [ ] **Step 5: Checkpoint**

Run:

```powershell
git diff -- public/index.html public/app.js public/styles.css
```

Expected: UI changes only. Commit only if the user explicitly requests commits in this workspace.

---

### Task 5: Update README And Final Verification

**Files:**
- Modify: `README.md`
- Verify: all changed files

- [ ] **Step 1: Update README mock-chain section**

Add this under `역할 분리` after the blockchain role bullet:

```md
- 스마트컨트랙트 이벤트 역할: `data/blockchain-receipts.json`이 local mock chain receipt를 oldest-first append-only로 저장합니다. API와 UI는 newest-first로 보여줍니다.
```

Add this section before `논문 문제와 프로토타입 대응`:

```md
## Local Mock Chain 설계

NeuroProof currently uses a local mock blockchain layer. Sensitive EEG files remain off-chain. The mock chain stores tamper-evident hashes, consent/access/proof events, and smart-contract-compatible transaction receipts. This avoids wallet, RPC, gas, and testnet failure during demos while keeping the data shape close to a future `EEGRegistry.sol` deployment.

저장되는 receipt는 `txHash`, `blockNumber`, `blockHash`, `contractAddress`, `eventName`, `eventSignature`, `gasUsed`, `previousReceiptHash`, `receiptHash`를 포함합니다. `previousReceiptHash`가 receipt들을 연결하므로 중간 삭제, 순서 변경, 필드 변조를 검증할 수 있습니다.

Sepolia 배포로 전환할 때는 `appendBlockchainReceipt()`를 다음 흐름으로 교체하면 됩니다.

1. `EEGRegistry.registerRecord(recordId, rawDataHash, analysisHash)` 같은 contract method 호출
2. `tx.wait()`
3. receipt에서 event log 파싱
4. 실제 `txHash`, `blockNumber`, `contractAddress`, `gasUsed`, `status`, `args` 저장
```

- [ ] **Step 2: Run complete tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: API smoke test filters**

Run:

```powershell
$base = 'http://localhost:3000'
$data = Invoke-RestMethod "$base/api/records"
$recordId = $data.records[0].recordId
$all = Invoke-RestMethod "$base/api/blockchain-receipts?limit=5"
$recordOnly = Invoke-RestMethod "$base/api/blockchain-receipts?recordId=$recordId"
$proofOnly = Invoke-RestMethod "$base/api/blockchain-receipts?eventName=ProofCertificateIssued"
[pscustomobject]@{
  allCount = $all.blockchainReceipts.Count
  recordOnlyMatches = ($recordOnly.blockchainReceipts | Where-Object { $_.recordId -ne $recordId }).Count -eq 0
  proofOnlyMatches = ($proofOnly.blockchainReceipts | Where-Object { $_.eventName -ne 'ProofCertificateIssued' }).Count -eq 0
  chainValid = $all.chainValid
} | ConvertTo-Json
```

Expected: `chainValid: true`, both match booleans `true`.

- [ ] **Step 4: Browser verification**

Use Browser/Chrome automation for `http://localhost:3000/`.

Verify with DOM checks:

```js
{
  hasSmartContractPanel: Boolean(document.querySelector("#blockchainReceipts")),
  receiptRows: document.querySelectorAll(".receiptItem").length,
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
}
```

Expected: `hasSmartContractPanel: true`, `receiptRows > 0`, `horizontalOverflow: false`, and console error count is `0`.

- [ ] **Step 5: Final status**

Run:

```powershell
git status --short -- neuroproof-prototype
```

Expected: only project files touched. Do not commit unless the user explicitly asks.

---

## Plan Self-Review

- Spec coverage: covers pure module, append-only storage/newest-first API, receipt chain validation, proof `certificateCoreHash`, fixed event args, Admin panel, README migration text, testing, and privacy non-goals.
- Placeholder scan: no `TBD`, `TODO`, or ambiguous "fill in later" steps.
- Type consistency: event names, helper names, route names, and receipt fields match between tasks.
