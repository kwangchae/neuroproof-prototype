const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  analyzeEegCsv,
  buildAccessGrant,
  buildAuditEntry,
  createConsentPolicyFromRequest,
  evaluateAccessRequest,
  buildLedgerBlock,
  buildProofCertificate,
  buildProofCore,
  certificateCoreHash,
  filterBlockchainReceipts,
  sha256Hex,
  simulateAuditLogTamper,
  simulateLedgerTamper,
  stableStringify,
  tamperEegContent,
  validateAccessGrant,
  validateAuditLog,
  validateLedger,
  verifyContent,
  withReceiptValidation
} = require("../server");
const {
  buildConsentPolicy,
  canAccessWithPolicy,
  validateConsentPolicy
} = require("../lib/policies");
const { riskLabelsForAnalysis } = require("../lib/risk-labels");
const { buildSecretSharingDemo } = require("../lib/secret-sharing-demo");
const {
  EVENT_NAMES,
  buildEventArgs,
  createMockReceipt,
  deriveMockAddress,
  validateReceiptChain,
  validateReceiptHash
} = require("../lib/blockchain-receipts");
const {
  blockchainStatusFromEnv,
  buildRealReceiptFromTransaction,
  toBytes32
} = require("../lib/blockchain-adapter");
const {
  createLocalStorageAdapter,
  normalizeStorageContentType,
  storageStatusFromEnv
} = require("../lib/cloud-storage");

const sample = fs.readFileSync(path.join(__dirname, "..", "sample", "eeg-sample.csv"), "utf8");

test("analyzeEegCsv extracts numeric EEG summaries", () => {
  const analysis = analyzeEegCsv(sample);

  assert.equal(analysis.rowCount, 12);
  assert.equal(analysis.channelCount, 5);
  assert.equal(analysis.channels.alpha.mean, 18.4583);
  assert.equal(analysis.bandSummary.focusIndex, 0.7255);
});

test("riskLabelsForAnalysis flags biometric and mental-state inference risk", () => {
  const labels = riskLabelsForAnalysis(analyzeEegCsv(sample));

  assert.equal(labels.some((label) => label.id === "raw-eeg-linkability"), true);
  assert.equal(labels.some((label) => label.id === "focus-inference"), true);
  assert.equal(labels.some((label) => label.id === "relaxation-inference"), true);
});

test("buildSecretSharingDemo reconstructs derived EEG metrics without raw samples", () => {
  const demo = buildSecretSharingDemo({
    recordId: "record-1",
    analysis: analyzeEegCsv(sample)
  });

  assert.equal(demo.input, "derived_band_summary_only");
  assert.equal(demo.shareCount, 3);
  assert.equal(demo.metrics.some((metric) => metric.metric === "focusIndex"), true);
  assert.equal(demo.metrics.every((metric) => metric.shares.length === 3), true);
  assert.equal(demo.metrics.every((metric) => metric.verified === true), true);
});

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

test("storage adapter defaults to local and reads uploaded EEG content", async () => {
  const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "neuroproof-storage-"));
  const storage = createLocalStorageAdapter({ localDir });

  try {
    const result = await storage.uploadObject({
      objectKey: "record-1.csv",
      content: sample,
      contentType: "text/csv; charset=utf-8"
    });

    assert.equal(storageStatusFromEnv({ STORAGE_PROVIDER: "local" }).configured, true);
    assert.equal(result.provider, "local");
    assert.equal(await storage.readObject("record-1.csv"), sample);
  } finally {
    fs.rmSync(localDir, { recursive: true, force: true });
  }
});

test("storage uploads strip charset parameters from MIME type", () => {
  assert.equal(normalizeStorageContentType("text/csv; charset=utf-8"), "text/csv");
  assert.equal(normalizeStorageContentType("TEXT/PLAIN; charset=UTF-8"), "text/plain");
});

test("Sepolia adapter helpers build bytes32 values and local receipt hashes", () => {
  const args = buildEventArgs(EVENT_NAMES.PROOF_CERTIFICATE_ISSUED, {
    proofId: "proof-1",
    recordId: "record-1",
    certificateCoreHash: "sha256:".concat("a".repeat(64)),
    actor: "demo-user",
    issuedAt: "2026-06-04T00:00:00.000Z"
  });
  const receipt = buildRealReceiptFromTransaction({
    eventName: EVENT_NAMES.PROOF_CERTIFICATE_ISSUED,
    recordId: "record-1",
    proofId: "proof-1",
    actor: "demo-user",
    args,
    linkedAuditEventHash: "audit-1"
  }, {
    previousReceiptHash: "0".repeat(64),
    createdAt: "2026-06-04T00:00:01.000Z",
    actorAddress: "0x1111111111111111111111111111111111111111",
    contractAddress: "0x2222222222222222222222222222222222222222"
  }, {
    blockNumber: 123,
    index: 0,
    status: 1,
    gasUsed: 54890n,
    hash: "0x".concat("b".repeat(64)),
    blockHash: "0x".concat("c".repeat(64)),
    logs: [{ address: "0x2222222222222222222222222222222222222222", index: 3 }]
  }, {
    chainId: 11155111,
    networkName: "sepolia"
  });

  assert.equal(toBytes32("sha256:".concat("d".repeat(64))), "0x".concat("d".repeat(64)));
  assert.equal(blockchainStatusFromEnv({ CHAIN_PROVIDER: "mock" }).configured, true);
  assert.equal(receipt.chainId, 11155111);
  assert.equal(receipt.networkName, "sepolia");
  assert.equal(receipt.logIndex, 3);
  assert.equal(validateReceiptHash(receipt), true);
});

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

test("verifyContent detects matching and changed EEG data", () => {
  const expectedRawHash = sha256Hex(sample);

  assert.equal(verifyContent(sample, expectedRawHash).matches, true);
  assert.equal(verifyContent(`${sample}\n`, expectedRawHash).matches, false);
});

test("tamperEegContent changes the content hash", () => {
  const tampered = tamperEegContent(sample);

  assert.notEqual(tampered, sample);
  assert.notEqual(sha256Hex(tampered), sha256Hex(sample));
});

test("buildProofCertificate includes record and ledger hashes", () => {
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

  const proof = buildProofCertificate({
    record,
    block,
    generatedAt: "2026-06-02T00:00:01.000Z"
  });

  assert.equal(proof.proofType, "NeuroProof EEG Integrity Certificate");
  assert.equal(proof.record.recordId, "record-1");
  assert.equal(proof.hashes.rawHash, block.rawHash);
  assert.equal(proof.hashes.previousHash, block.previousHash);
  assert.equal(proof.ledger.ledgerValidAtIssueTime, true);
  assert.equal(proof.privacy.rawDataLocation, "off-chain");
  assert.equal(proof.privacy.onChainData, "hashes_and_events_only");
  assert.equal(proof.privacy.userRights.includes("revoke_access"), true);
  assert.equal(proof.privacy.riskSummary.length > 0, true);
});

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

test("validateAccessGrant rejects tampered grants", () => {
  const grant = buildAccessGrant({
    grantId: "grant-1",
    recordId: "record-1",
    owner: "demo-user",
    grantee: "research-admin",
    status: "active",
    createdAt: "2026-06-02T00:00:00.000Z",
    revokedAt: null
  });

  assert.equal(validateAccessGrant(grant), true);
  assert.equal(validateAccessGrant({ ...grant, status: "revoked" }), false);
});

test("consent policies are purpose-bound and tamper-evident", () => {
  const policy = buildConsentPolicy({
    policyId: "policy-1",
    recordId: "record-1",
    owner: "demo-user",
    recipient: "research-admin",
    purpose: "research",
    dataScope: "derived-summary",
    status: "active",
    createdAt: "2026-06-04T00:00:00.000Z",
    expiresAt: "2026-12-31T23:59:59.000Z",
    revokedAt: null
  });

  assert.equal(validateConsentPolicy(policy), true);
  assert.equal(validateConsentPolicy({ ...policy, purpose: "marketing" }), false);
});

test("canAccessWithPolicy enforces purpose scope and revocation", () => {
  const policy = buildConsentPolicy({
    policyId: "policy-1",
    recordId: "record-1",
    owner: "demo-user",
    recipient: "research-admin",
    purpose: "research",
    dataScope: "derived-summary",
    status: "active",
    createdAt: "2026-06-04T00:00:00.000Z",
    expiresAt: "2026-12-31T23:59:59.000Z",
    revokedAt: null
  });

  assert.deepEqual(canAccessWithPolicy(policy, {
    recipient: "research-admin",
    purpose: "research",
    dataScope: "derived-summary",
    now: "2026-06-04T00:00:01.000Z"
  }), { allowed: true, reason: "policy_allows_request" });

  assert.equal(canAccessWithPolicy(policy, {
    recipient: "research-admin",
    purpose: "marketing",
    dataScope: "derived-summary",
    now: "2026-06-04T00:00:01.000Z"
  }).allowed, false);

  const revokedPolicy = buildConsentPolicy({
    ...policy,
    status: "revoked",
    revokedAt: "2026-06-05T00:00:00.000Z"
  });

  assert.equal(canAccessWithPolicy(revokedPolicy, {
    recipient: "research-admin",
    purpose: "research",
    dataScope: "derived-summary",
    now: "2026-06-04T00:00:01.000Z"
  }).reason, "policy_not_active");
});

test("createConsentPolicyFromRequest builds an owner-bound policy", () => {
  const { policy, valid } = createConsentPolicyFromRequest({
    records: [{ recordId: "record-1", owner: "demo-user" }],
    request: {
      recordId: "record-1",
      recipient: "research-admin",
      purpose: "Research",
      dataScope: "derived-summary"
    },
    now: "2026-06-04T00:00:00.000Z"
  });

  assert.equal(policy.owner, "demo-user");
  assert.equal(policy.purpose, "research");
  assert.equal(policy.status, "active");
  assert.equal(valid, true);
  assert.equal(validateConsentPolicy(policy), true);
});

test("evaluateAccessRequest approves research and denies blocked purposes", () => {
  const { policy } = createConsentPolicyFromRequest({
    records: [{ recordId: "record-1", owner: "demo-user" }],
    request: {
      recordId: "record-1",
      recipient: "research-admin",
      purpose: "research",
      dataScope: "derived-summary"
    },
    now: "2026-06-04T00:00:00.000Z"
  });

  const approved = evaluateAccessRequest({
    policies: [policy],
    request: {
      recordId: "record-1",
      recipient: "research-admin",
      purpose: "research",
      dataScope: "derived-summary"
    },
    now: "2026-06-04T00:00:01.000Z"
  });
  const denied = evaluateAccessRequest({
    policies: [policy],
    request: {
      recordId: "record-1",
      recipient: "research-admin",
      purpose: "marketing",
      dataScope: "derived-summary"
    },
    now: "2026-06-04T00:00:01.000Z"
  });

  assert.equal(approved.decision, "approved");
  assert.equal(approved.reason, "policy_allows_request");
  assert.equal(denied.decision, "denied");
  assert.equal(denied.reason, "no_matching_policy");
});

test("validateAuditLog rejects tampered audit events", () => {
  const first = buildAuditEntry({
    auditLog: [],
    actor: "demo-user",
    action: "upload_record",
    recordId: "record-1",
    details: { fileName: "eeg-sample.csv" },
    timestamp: "2026-06-02T00:00:00.000Z"
  });
  const second = buildAuditEntry({
    auditLog: [first],
    actor: "demo-user",
    action: "verify_original",
    recordId: "record-1",
    details: { matches: true },
    timestamp: "2026-06-02T00:00:01.000Z"
  });

  assert.equal(validateAuditLog([first, second]), true);
  assert.equal(validateAuditLog([{ ...first, actor: "other-user" }, second]), false);
});

test("tamper simulations detect copied ledger and audit mutations", () => {
  const ledgerBlock = buildLedgerBlock({
    ledger: [],
    recordId: "record-1",
    owner: "demo-user",
    rawHash: sha256Hex(sample),
    analysisHash: sha256Hex(stableStringify(analyzeEegCsv(sample))),
    objectKey: "record-1.csv",
    timestamp: "2026-06-02T00:00:00.000Z"
  });
  const auditEntry = buildAuditEntry({
    auditLog: [],
    actor: "demo-user",
    action: "upload_record",
    recordId: "record-1",
    details: { fileName: "eeg-sample.csv" },
    timestamp: "2026-06-02T00:00:01.000Z"
  });

  const ledgerSimulation = simulateLedgerTamper([ledgerBlock]);
  const auditSimulation = simulateAuditLogTamper([auditEntry]);

  assert.equal(ledgerSimulation.beforeValid, true);
  assert.equal(ledgerSimulation.afterValid, false);
  assert.equal(auditSimulation.beforeValid, true);
  assert.equal(auditSimulation.afterValid, false);
});

test("validateLedger rejects tampered blocks", () => {
  const first = buildLedgerBlock({
    ledger: [],
    recordId: "record-1",
    owner: "demo-user",
    rawHash: sha256Hex(sample),
    analysisHash: sha256Hex(stableStringify(analyzeEegCsv(sample))),
    objectKey: "record-1.csv",
    timestamp: "2026-05-28T00:00:00.000Z"
  });
  const second = buildLedgerBlock({
    ledger: [first],
    recordId: "record-2",
    owner: "demo-user",
    rawHash: sha256Hex("changed"),
    analysisHash: sha256Hex("analysis"),
    objectKey: "record-2.csv",
    timestamp: "2026-05-28T00:00:01.000Z"
  });

  assert.equal(validateLedger([first, second]), true);

  const tampered = [{ ...first, rawHash: sha256Hex("tampered") }, second];
  assert.equal(validateLedger(tampered), false);
});
