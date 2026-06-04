const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
try {
  require("dotenv").config({ quiet: true });
} catch {
  // dotenv is optional until real cloud/testnet mode is enabled.
}
const {
  buildConsentPolicy,
  canAccessWithPolicy,
  normalizePurpose,
  validateConsentPolicy
} = require("./lib/policies");
const {
  EVENT_NAMES,
  buildEventArgs,
  createMockReceipt,
  validateReceiptChain,
  validateReceiptHash
} = require("./lib/blockchain-receipts");
const {
  blockchainStatusFromEnv,
  createBlockchainAdapter
} = require("./lib/blockchain-adapter");
const {
  createStorageAdapter,
  storageStatusFromEnv
} = require("./lib/cloud-storage");
const { riskLabelsForAnalysis } = require("./lib/risk-labels");
const { buildSecretSharingDemo } = require("./lib/secret-sharing-demo");

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const SAMPLE_DIR = path.join(ROOT_DIR, "sample");
const DATA_DIR = path.join(ROOT_DIR, "data");
const CLOUD_DIR = path.join(DATA_DIR, "cloud-objects");
const LEDGER_PATH = path.join(DATA_DIR, "ledger.json");
const RECORDS_PATH = path.join(DATA_DIR, "records.json");
const AUDIT_LOG_PATH = path.join(DATA_DIR, "audit-log.json");
const ACCESS_GRANTS_PATH = path.join(DATA_DIR, "access-grants.json");
const CONSENT_POLICIES_PATH = path.join(DATA_DIR, "consent-policies.json");
const ACCESS_REQUESTS_PATH = path.join(DATA_DIR, "access-requests.json");
const BLOCKCHAIN_RECEIPTS_PATH = path.join(DATA_DIR, "blockchain-receipts.json");

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const body = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function parseCsvRows(content) {
  const lines = String(content)
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV must include a header and at least one data row.");
  }

  const headers = lines[0].split(",").map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",");
    return headers.reduce((row, header, index) => {
      row[header] = values[index] === undefined ? "" : values[index].trim();
      return row;
    }, {});
  });

  return { headers, rows };
}

function summarize(values) {
  const count = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / count);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;

  return {
    count,
    min: Number(min.toFixed(4)),
    max: Number(max.toFixed(4)),
    mean: Number(mean.toFixed(4)),
    rms: Number(rms.toFixed(4)),
    variance: Number(variance.toFixed(4))
  };
}

function analyzeEegCsv(content) {
  const { headers, rows } = parseCsvRows(content);
  const channels = {};

  for (const header of headers) {
    if (/^(time|timestamp|sample|index)$/i.test(header)) {
      continue;
    }

    const values = rows
      .map((row) => Number(row[header]))
      .filter((value) => Number.isFinite(value));

    if (values.length > 0) {
      channels[header] = summarize(values);
    }
  }

  if (Object.keys(channels).length === 0) {
    throw new Error("CSV must include at least one numeric EEG column.");
  }

  const lowerNames = Object.fromEntries(
    Object.keys(channels).map((name) => [name.toLowerCase(), name])
  );
  const alpha = lowerNames.alpha ? channels[lowerNames.alpha].mean : null;
  const beta = lowerNames.beta ? channels[lowerNames.beta].mean : null;
  const theta = lowerNames.theta ? channels[lowerNames.theta].mean : null;

  const bandSummary = {};
  if (theta !== null) bandSummary.thetaMean = theta;
  if (alpha !== null) bandSummary.alphaMean = alpha;
  if (beta !== null) bandSummary.betaMean = beta;
  if (alpha && beta !== null) {
    bandSummary.focusIndex = Number((beta / alpha).toFixed(4));
  }
  if (alpha !== null && beta !== null && theta !== null) {
    bandSummary.relaxationIndex = Number((alpha / (beta + theta)).toFixed(4));
  }

  return {
    rowCount: rows.length,
    channelCount: Object.keys(channels).length,
    channels,
    bandSummary
  };
}

function buildLedgerBlock({ ledger, recordId, owner, rawHash, analysisHash, objectKey, timestamp }) {
  const previousHash = ledger.length > 0 ? ledger[ledger.length - 1].blockHash : "0".repeat(64);
  const blockBase = {
    index: ledger.length,
    timestamp,
    recordId,
    owner,
    rawHash,
    analysisHash,
    objectKey,
    previousHash
  };

  return {
    ...blockBase,
    blockHash: sha256Hex(stableStringify(blockBase))
  };
}

function validateLedger(ledger) {
  let previousHash = "0".repeat(64);

  for (let index = 0; index < ledger.length; index += 1) {
    const block = ledger[index];
    const { blockHash, ...blockBase } = block;

    if (block.index !== index || block.previousHash !== previousHash) {
      return false;
    }

    if (sha256Hex(stableStringify(blockBase)) !== blockHash) {
      return false;
    }

    previousHash = blockHash;
  }

  return true;
}

function buildAuditEntry({ auditLog, actor, action, recordId, details, timestamp }) {
  const previousHash = auditLog.length > 0 ? auditLog[auditLog.length - 1].eventHash : "0".repeat(64);
  const entryBase = {
    index: auditLog.length,
    timestamp,
    actor,
    action,
    recordId,
    details,
    previousHash
  };

  return {
    ...entryBase,
    eventHash: sha256Hex(stableStringify(entryBase))
  };
}

function validateAuditLog(auditLog) {
  let previousHash = "0".repeat(64);

  for (let index = 0; index < auditLog.length; index += 1) {
    const entry = auditLog[index];
    const { eventHash, ...entryBase } = entry;

    if (entry.index !== index || entry.previousHash !== previousHash) {
      return false;
    }

    if (sha256Hex(stableStringify(entryBase)) !== eventHash) {
      return false;
    }

    previousHash = eventHash;
  }

  return true;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function simulateLedgerTamper(ledger) {
  const beforeValid = validateLedger(ledger);

  if (ledger.length === 0) {
    return {
      simulationType: "ledger_block_tamper",
      targetIndex: null,
      changedField: null,
      beforeValid,
      afterValid: null,
      message: "No ledger block is available to tamper."
    };
  }

  const tamperedLedger = cloneJson(ledger);
  const targetIndex = tamperedLedger.length - 1;
  tamperedLedger[targetIndex].rawHash = sha256Hex(`tampered-${tamperedLedger[targetIndex].rawHash}`);

  return {
    simulationType: "ledger_block_tamper",
    targetIndex,
    changedField: "rawHash",
    beforeValid,
    afterValid: validateLedger(tamperedLedger),
    originalHash: ledger[targetIndex].blockHash,
    simulatedHash: tamperedLedger[targetIndex].blockHash,
    message: "A copied ledger block was changed without recalculating the chain hash."
  };
}

function simulateAuditLogTamper(auditLog) {
  const beforeValid = validateAuditLog(auditLog);

  if (auditLog.length === 0) {
    return {
      simulationType: "audit_log_tamper",
      targetIndex: null,
      changedField: null,
      beforeValid,
      afterValid: null,
      message: "No audit event is available to tamper."
    };
  }

  const tamperedAuditLog = cloneJson(auditLog);
  const targetIndex = tamperedAuditLog.length - 1;
  tamperedAuditLog[targetIndex].actor = `${tamperedAuditLog[targetIndex].actor}-tampered`;

  return {
    simulationType: "audit_log_tamper",
    targetIndex,
    changedField: "actor",
    beforeValid,
    afterValid: validateAuditLog(tamperedAuditLog),
    originalHash: auditLog[targetIndex].eventHash,
    simulatedHash: tamperedAuditLog[targetIndex].eventHash,
    message: "A copied audit event was changed without recalculating the event hash."
  };
}

function verifyContent(content, expectedRawHash) {
  const computedHash = sha256Hex(content);
  return {
    computedHash,
    expectedRawHash,
    matches: computedHash === expectedRawHash
  };
}

function buildAccessGrant({ grantId, recordId, owner, grantee, status, createdAt, revokedAt }) {
  const grantBase = {
    grantId,
    recordId,
    owner,
    grantee,
    status,
    createdAt,
    revokedAt: revokedAt || null
  };

  return {
    ...grantBase,
    grantHash: sha256Hex(stableStringify(grantBase))
  };
}

function validateAccessGrant(grant) {
  if (!grant || typeof grant !== "object") {
    return false;
  }

  const { grantHash, ...grantBase } = grant;
  return sha256Hex(stableStringify(grantBase)) === grantHash;
}

function addDaysIso(timestamp, days) {
  const date = new Date(timestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function createConsentPolicyFromRequest({ records, request, now }) {
  const body = request || {};
  const record = (records || []).find((item) => item.recordId === body.recordId);

  if (!record) {
    throw new Error("Record not found.");
  }

  const timestamp = now || new Date().toISOString();
  const policy = buildConsentPolicy({
    policyId: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    recordId: record.recordId,
    owner: record.owner,
    recipient: String(body.recipient || "research-admin").trim() || "research-admin",
    purpose: normalizePurpose(body.purpose || "research"),
    dataScope: String(body.dataScope || "derived-summary").trim() || "derived-summary",
    status: "active",
    createdAt: timestamp,
    expiresAt: body.expiresAt || addDaysIso(timestamp, 90),
    revokedAt: null
  });

  return {
    policy,
    valid: validateConsentPolicy(policy)
  };
}

function evaluateAccessRequest({ policies, request, now }) {
  const body = request || {};
  const timestamp = now || new Date().toISOString();
  const recipient = String(body.recipient || "research-admin").trim() || "research-admin";
  const purpose = normalizePurpose(body.purpose || "research");
  const dataScope = String(body.dataScope || "derived-summary").trim() || "derived-summary";
  const matchingPolicy = (policies || []).find((policy) => {
    if (body.policyId && policy.policyId !== body.policyId) {
      return false;
    }
    return policy.recordId === body.recordId &&
      policy.recipient === recipient &&
      policy.purpose === purpose;
  });
  const result = matchingPolicy
    ? canAccessWithPolicy(matchingPolicy, { recipient, purpose, dataScope, now: timestamp })
    : { allowed: false, reason: "no_matching_policy" };
  const requestBase = {
    requestId: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    recordId: body.recordId,
    recipient,
    purpose,
    dataScope,
    requestedAt: timestamp,
    policyId: matchingPolicy ? matchingPolicy.policyId : null,
    policyHash: matchingPolicy ? matchingPolicy.policyHash : null,
    decision: result.allowed ? "approved" : "denied",
    reason: result.reason
  };

  return {
    ...requestBase,
    requestHash: sha256Hex(stableStringify(requestBase))
  };
}

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

function tamperEegContent(content) {
  const lines = String(content).split(/\r?\n/);

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const cells = lines[lineIndex].split(",");

    for (let cellIndex = 1; cellIndex < cells.length; cellIndex += 1) {
      const value = Number(cells[cellIndex]);
      if (Number.isFinite(value)) {
        cells[cellIndex] = String(value + 0.01);
        lines[lineIndex] = cells.join(",");
        return lines.join("\n");
      }
    }
  }

  return `${content}\n#tampered`;
}

async function ensureDataDirs() {
  await fs.mkdir(CLOUD_DIR, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

function cleanFileName(fileName) {
  return path.basename(String(fileName || "eeg.csv")).replace(/[^\w.-]/g, "_");
}

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

async function appendAuditEvent({ actor, action, recordId, details }) {
  await ensureDataDirs();

  const auditLog = await readJson(AUDIT_LOG_PATH, []);
  const entry = buildAuditEntry({
    auditLog,
    actor: String(actor || "system").trim() || "system",
    action,
    recordId,
    details,
    timestamp: new Date().toISOString()
  });

  const nextAuditLog = [...auditLog, entry];
  await writeJson(AUDIT_LOG_PATH, nextAuditLog);
  return { entry, auditLogValid: validateAuditLog(nextAuditLog) };
}

async function readBlockchainReceipts() {
  return readJson(BLOCKCHAIN_RECEIPTS_PATH, []);
}

function runtimeStatus() {
  return {
    storage: storageStatusFromEnv(process.env),
    blockchain: blockchainStatusFromEnv(process.env)
  };
}

function cloudStorage() {
  return createStorageAdapter({
    env: process.env,
    localDir: CLOUD_DIR
  });
}

async function uploadCloudObject({ objectKey, content, contentType }) {
  return cloudStorage().uploadObject({ objectKey, content, contentType });
}

async function readCloudObject(objectKey) {
  return cloudStorage().readObject(objectKey);
}

async function appendBlockchainReceipt({ eventName, recordId, policyId, accessRequestId, proofId, actor, args, linkedAuditEventHash }) {
  await ensureDataDirs();
  const receipts = await readBlockchainReceipts();
  const previousReceiptHash = receipts.length > 0 ? receipts[receipts.length - 1].receiptHash : "0".repeat(64);
  const input = {
    eventName,
    recordId,
    policyId,
    accessRequestId,
    proofId,
    actor,
    args,
    linkedAuditEventHash
  };
  const context = {
    previousReceiptHash,
    blockNumber: receipts.length + 1,
    transactionIndex: 0,
    logIndex: 0,
    createdAt: new Date().toISOString()
  };
  const adapter = createBlockchainAdapter({ env: process.env });
  const receipt = adapter.provider === "sepolia"
    ? await adapter.createReceipt(input, context)
    : createMockReceipt(input, context);
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

async function createRecord({ fileName, owner, content }) {
  if (!content || !String(content).trim()) {
    throw new Error("EEG CSV content is required.");
  }

  await ensureDataDirs();

  const timestamp = new Date().toISOString();
  const recordId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  const safeFileName = cleanFileName(fileName);
  const objectKey = `${recordId}-${safeFileName}`;
  const rawHash = sha256Hex(content);
  const analysis = analyzeEegCsv(content);
  const analysisHash = sha256Hex(stableStringify(analysis));
  const ledger = await readJson(LEDGER_PATH, []);
  const block = buildLedgerBlock({
    ledger,
    recordId,
    owner: String(owner || "demo-user").trim() || "demo-user",
    rawHash,
    analysisHash,
    objectKey,
    timestamp
  });

  const storage = await uploadCloudObject({
    objectKey,
    content,
    contentType: "text/csv; charset=utf-8"
  });
  const nextLedger = [...ledger, block];
  await writeJson(LEDGER_PATH, nextLedger);

  const record = {
    recordId,
    fileName: safeFileName,
    owner: block.owner,
    timestamp,
    rawHash,
    analysisHash,
    objectKey,
    storage,
    blockHash: block.blockHash,
    analysis,
    riskLabels: riskLabelsForAnalysis(analysis)
  };
  const records = await readJson(RECORDS_PATH, []);
  await writeJson(RECORDS_PATH, [record, ...records]);
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

  return { record, ledgerValid: validateLedger(nextLedger) };
}

async function createConsentPolicy(request) {
  const records = await readJson(RECORDS_PATH, []);
  const policies = await readJson(CONSENT_POLICIES_PATH, []);
  const result = createConsentPolicyFromRequest({ records, request });

  await writeJson(CONSENT_POLICIES_PATH, [result.policy, ...policies]);
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

  return result;
}

async function revokeConsentPolicy({ policyId, actor }) {
  const policies = await readJson(CONSENT_POLICIES_PATH, []);
  const policyIndex = policies.findIndex((policy) => policy.policyId === policyId);

  if (policyIndex === -1) {
    throw new Error("Consent policy not found.");
  }

  const currentPolicy = policies[policyIndex];
  const revokedAt = new Date().toISOString();
  const revokedPolicy = buildConsentPolicy({
    ...currentPolicy,
    status: "revoked",
    revokedAt
  });
  const nextPolicies = [...policies];
  nextPolicies[policyIndex] = revokedPolicy;

  await writeJson(CONSENT_POLICIES_PATH, nextPolicies);
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

  return {
    policy: revokedPolicy,
    valid: validateConsentPolicy(revokedPolicy)
  };
}

async function createAccessRequest(request) {
  const policies = await readJson(CONSENT_POLICIES_PATH, []);
  const accessRequests = await readJson(ACCESS_REQUESTS_PATH, []);
  const accessRequest = evaluateAccessRequest({ policies, request });

  await writeJson(ACCESS_REQUESTS_PATH, [accessRequest, ...accessRequests]);
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

  return accessRequest;
}

async function createAccessGrant({ recordId, actor, grantee }) {
  const records = await readJson(RECORDS_PATH, []);
  const record = records.find((item) => item.recordId === recordId);

  if (!record) {
    throw new Error("Record not found.");
  }

  const accessGrants = await readJson(ACCESS_GRANTS_PATH, []);
  const timestamp = new Date().toISOString();
  const grant = buildAccessGrant({
    grantId: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    recordId,
    owner: record.owner,
    grantee: String(grantee || "research-admin").trim() || "research-admin",
    status: "active",
    createdAt: timestamp,
    revokedAt: null
  });

  await writeJson(ACCESS_GRANTS_PATH, [grant, ...accessGrants]);
  await appendAuditEvent({
    actor: actor || record.owner,
    action: "grant_access",
    recordId,
    details: {
      grantId: grant.grantId,
      grantee: grant.grantee,
      grantHash: grant.grantHash
    }
  });

  return { grant, valid: validateAccessGrant(grant), allowed: true };
}

async function revokeAccessGrant({ grantId, actor }) {
  const accessGrants = await readJson(ACCESS_GRANTS_PATH, []);
  const grantIndex = accessGrants.findIndex((grant) => grant.grantId === grantId);

  if (grantIndex === -1) {
    throw new Error("Access grant not found.");
  }

  const currentGrant = accessGrants[grantIndex];
  const revokedGrant = buildAccessGrant({
    ...currentGrant,
    status: "revoked",
    revokedAt: new Date().toISOString()
  });

  const nextAccessGrants = [...accessGrants];
  nextAccessGrants[grantIndex] = revokedGrant;
  await writeJson(ACCESS_GRANTS_PATH, nextAccessGrants);
  await appendAuditEvent({
    actor: actor || currentGrant.owner,
    action: "revoke_access",
    recordId: currentGrant.recordId,
    details: {
      grantId: currentGrant.grantId,
      grantee: currentGrant.grantee,
      grantHash: revokedGrant.grantHash
    }
  });

  return {
    grant: revokedGrant,
    valid: validateAccessGrant(revokedGrant),
    allowed: false
  };
}

async function verifyAccessGrant({ grantId, actor }) {
  const accessGrants = await readJson(ACCESS_GRANTS_PATH, []);
  const grant = accessGrants.find((item) => item.grantId === grantId);

  if (!grant) {
    throw new Error("Access grant not found.");
  }

  const valid = validateAccessGrant(grant);
  const allowed = valid && grant.status === "active";
  await appendAuditEvent({
    actor: actor || "admin",
    action: "verify_access_grant",
    recordId: grant.recordId,
    details: {
      grantId,
      grantee: grant.grantee,
      valid,
      allowed
    }
  });

  return { grant, valid, allowed };
}

async function verifyStoredRecord({ recordId, tampered, actor }) {
  const records = await readJson(RECORDS_PATH, []);
  const record = records.find((item) => item.recordId === recordId);

  if (!record) {
    throw new Error("Record not found.");
  }

  const storedContent = await readCloudObject(record.objectKey);
  const content = tampered ? tamperEegContent(storedContent) : storedContent;
  const result = verifyContent(content, record.rawHash);

  await appendAuditEvent({
    actor: actor || record.owner,
    action: tampered ? "verify_tampered_demo" : "verify_original",
    recordId,
    details: {
      matches: result.matches,
      computedHash: result.computedHash
    }
  });

  return {
    recordId,
    tampered: Boolean(tampered),
    ...result
  };
}

async function readProofCertificate(recordId, actor = "demo-user") {
  const ledger = await readJson(LEDGER_PATH, []);
  const records = await readJson(RECORDS_PATH, []);
  const record = records.find((item) => item.recordId === recordId);

  if (!record) {
    throw new Error("Record not found.");
  }

  if (!validateLedger(ledger)) {
    throw new Error("Ledger is not valid.");
  }

  const block = ledger.find((item) => item.recordId === recordId);
  if (!block) {
    throw new Error("Ledger block not found.");
  }

  const existingReceipt = await latestReceiptForRecord(recordId, EVENT_NAMES.PROOF_CERTIFICATE_ISSUED);
  const generatedAt = existingReceipt && existingReceipt.args && existingReceipt.args.issuedAt
    ? existingReceipt.args.issuedAt
    : new Date().toISOString();
  const core = buildProofCore({ record, block, generatedAt });
  const coreHash = certificateCoreHash(core);
  let transactionReceipt = null;

  if (existingReceipt && existingReceipt.args.certificateCoreHash === coreHash) {
    transactionReceipt = existingReceipt;
  } else {
    const proofId = `${recordId}:${coreHash}`;
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
      proofId,
      actor,
      args: buildEventArgs(EVENT_NAMES.PROOF_CERTIFICATE_ISSUED, {
        proofId,
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
}

async function readSecretSharingDemo(recordId, actor = "admin") {
  const records = await readJson(RECORDS_PATH, []);
  const record = records.find((item) => item.recordId === recordId);

  if (!record) {
    throw new Error("Record not found.");
  }

  const demo = {
    generatedAt: new Date().toISOString(),
    ...buildSecretSharingDemo({
      recordId,
      analysis: record.analysis
    })
  };

  await appendAuditEvent({
    actor,
    action: "run_secret_sharing_demo",
    recordId,
    details: {
      input: demo.input,
      rawEegUsed: demo.rawEegUsed,
      shareCount: demo.shareCount,
      metricCount: demo.metrics.length
    }
  });

  return demo;
}

async function runTamperSimulation() {
  const ledger = await readJson(LEDGER_PATH, []);
  const auditLog = await readJson(AUDIT_LOG_PATH, []);

  return {
    generatedAt: new Date().toISOString(),
    ledger: simulateLedgerTamper(ledger),
    auditLog: simulateAuditLogTamper(auditLog)
  };
}

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) {
      throw new Error("Request body is too large for this prototype.");
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
  }[ext] || "application/octet-stream";
}

async function serveFile(response, baseDir, pathname) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(baseDir, requestedPath);
  const basePath = path.resolve(baseDir);

  if (!filePath.startsWith(basePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(file);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500);
    response.end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/records") {
      const ledger = await readJson(LEDGER_PATH, []);
      const records = await readJson(RECORDS_PATH, []);
      const auditLog = await readJson(AUDIT_LOG_PATH, []);
      const accessGrants = await readJson(ACCESS_GRANTS_PATH, []);
      const consentPolicies = await readJson(CONSENT_POLICIES_PATH, []);
      const accessRequests = await readJson(ACCESS_REQUESTS_PATH, []);
      const blockchainReceipts = await readBlockchainReceipts();
      const validatedReceipts = withReceiptValidation(blockchainReceipts);
      const recordsWithRiskLabels = records.map((record) => ({
        ...record,
        riskLabels: record.riskLabels || riskLabelsForAnalysis(record.analysis)
      }));
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
        auditLogValid: validateAuditLog(auditLog),
        runtime: runtimeStatus()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/runtime") {
      sendJson(response, 200, runtimeStatus());
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/proofs/")) {
      const recordId = decodeURIComponent(url.pathname.replace(/^\/api\/proofs\//, ""));
      const actor = url.searchParams.get("actor") || "demo-user";
      sendJson(response, 200, await readProofCertificate(recordId, actor));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/tamper-simulation") {
      sendJson(response, 200, await runTamperSimulation());
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/secret-sharing-demo/")) {
      const recordId = decodeURIComponent(url.pathname.replace(/^\/api\/secret-sharing-demo\//, ""));
      const actor = url.searchParams.get("actor") || "admin";
      sendJson(response, 200, await readSecretSharingDemo(recordId, actor));
      return;
    }

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

    if (request.method === "POST" && url.pathname === "/api/records") {
      const body = await readRequestJson(request);
      sendJson(response, 201, await createRecord(body));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/consent-policies") {
      const body = await readRequestJson(request);
      sendJson(response, 201, await createConsentPolicy(body));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/consent-policies/revoke") {
      const body = await readRequestJson(request);
      sendJson(response, 200, await revokeConsentPolicy(body));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/access-requests") {
      const body = await readRequestJson(request);
      sendJson(response, 201, await createAccessRequest(body));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/access-grants") {
      const body = await readRequestJson(request);
      sendJson(response, 201, await createAccessGrant(body));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/access-grants/revoke") {
      const body = await readRequestJson(request);
      sendJson(response, 200, await revokeAccessGrant(body));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/access-grants/verify") {
      const body = await readRequestJson(request);
      sendJson(response, 200, await verifyAccessGrant(body));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/verify") {
      const body = await readRequestJson(request);
      sendJson(response, 200, verifyContent(body.content || "", body.expectedRawHash || ""));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/demo-verify") {
      const body = await readRequestJson(request);
      sendJson(response, 200, await verifyStoredRecord(body));
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/sample/")) {
      await serveFile(response, SAMPLE_DIR, url.pathname.replace(/^\/sample\//, ""));
      return;
    }

    if (request.method === "GET") {
      await serveFile(response, PUBLIC_DIR, url.pathname);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

if (require.main === module) {
  ensureDataDirs().then(() => {
    http.createServer(handleRequest).listen(PORT, () => {
      console.log(`NeuroProof running at http://localhost:${PORT}`);
    });
  });
}

module.exports = {
  analyzeEegCsv,
  buildAccessGrant,
  buildAuditEntry,
  buildLedgerBlock,
  buildProofCertificate,
  buildProofCore,
  certificateCoreHash,
  createConsentPolicyFromRequest,
  createRecord,
  evaluateAccessRequest,
  filterBlockchainReceipts,
  runtimeStatus,
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
};
