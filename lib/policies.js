const crypto = require("node:crypto");

const BLOCKED_PURPOSES = new Set(["marketing", "employer"]);
const SCOPE_ORDER = {
  "derived-summary": 1,
  "derived-inference": 2,
  "raw-eeg": 3
};

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizePurpose(purpose) {
  return String(purpose || "").trim().toLowerCase();
}

function buildConsentPolicy({
  policyId,
  recordId,
  owner,
  recipient,
  purpose,
  dataScope,
  status,
  createdAt,
  expiresAt,
  revokedAt
}) {
  const policyBase = {
    policyId,
    recordId,
    owner,
    recipient,
    purpose: normalizePurpose(purpose),
    dataScope,
    status,
    createdAt,
    expiresAt,
    revokedAt: revokedAt || null
  };

  return {
    ...policyBase,
    policyHash: sha256Hex(stableStringify(policyBase))
  };
}

function validateConsentPolicy(policy) {
  if (!policy || typeof policy !== "object") {
    return false;
  }
  const { policyHash, ...policyBase } = policy;
  return sha256Hex(stableStringify(policyBase)) === policyHash;
}

function canAccessWithPolicy(policy, request) {
  if (!validateConsentPolicy(policy)) {
    return { allowed: false, reason: "policy_hash_invalid" };
  }
  if (policy.status !== "active") {
    return { allowed: false, reason: "policy_not_active" };
  }
  if (policy.expiresAt && new Date(request.now).getTime() > new Date(policy.expiresAt).getTime()) {
    return { allowed: false, reason: "policy_expired" };
  }
  if (policy.recipient !== request.recipient) {
    return { allowed: false, reason: "recipient_mismatch" };
  }
  if (policy.purpose !== normalizePurpose(request.purpose)) {
    return { allowed: false, reason: "purpose_mismatch" };
  }
  if (BLOCKED_PURPOSES.has(normalizePurpose(request.purpose))) {
    return { allowed: false, reason: "purpose_blocked_by_default" };
  }
  if (!SCOPE_ORDER[policy.dataScope] || !SCOPE_ORDER[request.dataScope]) {
    return { allowed: false, reason: "unknown_data_scope" };
  }
  if (SCOPE_ORDER[request.dataScope] > SCOPE_ORDER[policy.dataScope]) {
    return { allowed: false, reason: "scope_exceeds_policy" };
  }
  return { allowed: true, reason: "policy_allows_request" };
}

module.exports = {
  buildConsentPolicy,
  canAccessWithPolicy,
  normalizePurpose,
  validateConsentPolicy
};
