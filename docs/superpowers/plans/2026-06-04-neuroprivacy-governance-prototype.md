# NeuroPrivacy Governance Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend NeuroProof into a paper-grounded prototype that addresses EEG/neurodata privacy problems: verifiable consent, revocation, purpose limitation, transparency, auditability, raw-vs-derived data separation, and privacy-preserving analysis demonstration.

**Execution Status (2026-06-04):** Tasks 1-6 are implemented and verified. `npm test` passes with 14 tests, API smoke tests pass for consent policies, access decisions, secret-sharing demo, and privacy receipts, and browser DOM checks pass for User/Admin screens. Commit steps were intentionally skipped because no commit was requested.

**Architecture:** Keep EEG raw data off-chain and in the existing local cloud-object store. Add a governance layer around existing records: purpose-bound consent policies, access requests, derived-neurodata risk labels, verifiable receipts, and a toy secret-sharing analysis demo. Continue using local JSON stores and hash chains as blockchain stand-ins, with clean seams for later smart-contract migration.

**Tech Stack:** Node.js built-in HTTP server, browser JavaScript, JSON local stores, SHA-256 hash commitments, existing `server.js`, existing static UI, Node test runner.

---

## Research Basis

This plan is based on searched paper sources and current NeuroProof functionality.

- Kablo & Arias-Cabarcos, **Privacy in the Age of Neurotechnology: Investigating Public Attitudes towards Brain Data Collection and Use**, CCS 2023. Source: https://doi.org/10.1145/3576915.3623164 and https://ris.uni-paderborn.de/record/49373. Main problems: users care strongly about consent, transparency, purpose, recipient, and revocation; doctors/researchers are more acceptable recipients than marketing/employers; users do not fully understand what can be inferred from brain data.
- Agarwal et al., **Protecting Privacy of Users in Brain-Computer Interface Applications**, IEEE TNSRE 2019. Source: https://doi.org/10.1109/TNSRE.2019.2926965. Main problems: EEG can leak highly private information; meaningful EEG-based ML should be possible without exposing individual EEG records; SMC is one technical direction.
- Xia et al., **Privacy-Preserving Brain-Computer Interfaces: A Systematic Review**, 2024. Source: https://arxiv.org/abs/2412.11394. Main problems: BCI data processing involves multiple parties and privacy is under-addressed across the workflow.
- Mandal & Saxena, **SoK: Your Mind Tells a Lot About You: On the Privacy Leakage via Brainwave Devices**, 2022. Source: https://www.researchgate.net/publication/360627973_SoK_Your_Mind_Tells_a_Lot_About_You_On_the_Privacy_Leakage_via_Brainwave_Devices. Main problem: neurodata can reveal multiple private attributes, so derived inferences matter, not only raw EEG.
- Mondal et al., **Enhancing Privacy in EEG Signal Classification through Blockchain Technology and Fully Homomorphic Encryption**, 2024. Source found by paper search; use this as a background direction, then verify venue/full text before final citation. Main idea: blockchain can manage decentralized access control while encrypted computation protects EEG data.
- Kellmeyer, **Big Brain Data: On the Responsible Use of Brain Data from Clinical and Consumer-Directed Neurotechnological Devices**, Neuroethics. Source: https://link.springer.com/article/10.1007/s12152-018-9371-x. Main design guidance: raw brain data should not be freely centralized; consent, security, governance, and data literacy are relevant safeguards.
- Chelladurai et al., **Blockchain in Healthcare Systems: A New Hope**, 2021. Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC8081770/. Useful architectural pattern: off-chain sensitive health records, on-chain permissions, audit logs, and grant/revoke flows.

## Problem-To-Prototype Mapping

| Paper problem | Prototype response |
| --- | --- |
| Consent is often vague and hard to verify | Add purpose-bound consent policies with hash commitments |
| Users need revocable consent | Add explicit policy revocation and audit log events |
| Recipient and purpose change acceptability | Add purpose categories: `medical`, `research`, `wellness`, `marketing`, `employer`; block high-risk purposes by default |
| Users do not understand neurodata risks | Add risk labels for raw EEG and derived metrics |
| Derived neurodata can be more sensitive than raw signals | Separate `raw-eeg`, `derived-summary`, and `derived-inference` scopes |
| EEG should not be directly exposed for ML | Add a toy additive secret-sharing aggregate demo |
| Transparency and auditability are needed | Extend proof certificates into user-readable privacy receipts |

## File Structure

- Create: `neuroproof-prototype/lib/policies.js`  
  Consent policy construction, validation, and purpose/scope enforcement.

- Create: `neuroproof-prototype/lib/risk-labels.js`  
  Static paper-grounded risk labels for raw EEG and derived neurodata fields.

- Create: `neuroproof-prototype/lib/secret-sharing-demo.js`  
  Toy additive secret-sharing demo for aggregate EEG band values. This is explicitly a teaching demo, not production cryptography.

- Modify: `neuroproof-prototype/server.js`  
  Add JSON store paths, endpoints for consent policies and access requests, receipt generation, and privacy-preserving aggregate demo.

- Modify: `neuroproof-prototype/public/index.html`  
  Add User consent policy panel, Admin access request panel, risk label panel, and privacy-preserving analysis demo panel.

- Modify: `neuroproof-prototype/public/app.js`  
  Render policies, access decisions, risk labels, receipts, and secret-sharing demo results.

- Modify: `neuroproof-prototype/public/styles.css`  
  Style new panels without changing the existing visual system.

- Modify: `neuroproof-prototype/test/server.test.js`  
  Add tests for policy hash validation, access decisions, risk labels, and secret-sharing demo behavior.

- Modify: `neuroproof-prototype/README.md`  
  Document how each new feature maps to a paper problem.

---

### Task 1: Add Purpose-Bound Consent Policy Module

**Files:**
- Create: `neuroproof-prototype/lib/policies.js`
- Modify: `neuroproof-prototype/test/server.test.js`

- [ ] **Step 1: Write failing policy tests**

Append this import block update to `neuroproof-prototype/test/server.test.js` after the existing `require("../server")` import block:

```js
const {
  buildConsentPolicy,
  canAccessWithPolicy,
  validateConsentPolicy
} = require("../lib/policies");
```

Append these tests near the existing grant/audit tests:

```js
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

  assert.equal(canAccessWithPolicy({ ...policy, status: "revoked" }, {
    recipient: "research-admin",
    purpose: "research",
    dataScope: "derived-summary",
    now: "2026-06-04T00:00:01.000Z"
  }).reason, "policy_not_active");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test
```

Expected: FAIL with `Cannot find module '../lib/policies'`.

- [ ] **Step 3: Create policy module**

Create `neuroproof-prototype/lib/policies.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```powershell
npm test
```

Expected: PASS, including the two new consent policy tests.

- [ ] **Step 5: Commit**

```powershell
git add neuroproof-prototype/lib/policies.js neuroproof-prototype/test/server.test.js
git commit -m "feat: add purpose-bound consent policies"
```

---

### Task 2: Add Consent Policy And Access Request APIs

**Files:**
- Modify: `neuroproof-prototype/server.js`
- Test: `neuroproof-prototype/test/server.test.js`

- [ ] **Step 1: Add failing server export test**

Append this to `neuroproof-prototype/test/server.test.js`:

```js
test("server exports consent policy helpers", () => {
  const server = require("../server");

  assert.equal(typeof server.createConsentPolicyFromRequest, "function");
  assert.equal(typeof server.evaluateAccessRequest, "function");
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm test
```

Expected: FAIL because `createConsentPolicyFromRequest` and `evaluateAccessRequest` are not exported.

- [ ] **Step 3: Add server imports and JSON paths**

In `neuroproof-prototype/server.js`, add after the current path constants:

```js
const CONSENT_POLICIES_PATH = path.join(DATA_DIR, "consent-policies.json");
const ACCESS_REQUESTS_PATH = path.join(DATA_DIR, "access-requests.json");
```

Add after existing `require` lines:

```js
const {
  buildConsentPolicy,
  canAccessWithPolicy,
  validateConsentPolicy
} = require("./lib/policies");
```

- [ ] **Step 4: Add minimal consent policy functions**

Add near the current access grant functions in `server.js`:

```js
async function createConsentPolicyFromRequest({
  recordId,
  actor,
  recipient,
  purpose,
  dataScope,
  expiresAt
}) {
  const records = await readJson(RECORDS_PATH, []);
  const record = records.find((item) => item.recordId === recordId);

  if (!record) {
    throw new Error("Record not found.");
  }

  const consentPolicies = await readJson(CONSENT_POLICIES_PATH, []);
  const createdAt = new Date().toISOString();
  const policy = buildConsentPolicy({
    policyId: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    recordId,
    owner: record.owner,
    recipient: String(recipient || "research-admin").trim() || "research-admin",
    purpose: String(purpose || "research").trim() || "research",
    dataScope: String(dataScope || "derived-summary").trim() || "derived-summary",
    status: "active",
    createdAt,
    expiresAt: expiresAt || "2026-12-31T23:59:59.000Z",
    revokedAt: null
  });

  await writeJson(CONSENT_POLICIES_PATH, [policy, ...consentPolicies]);
  await appendAuditEvent({
    actor: actor || record.owner,
    action: "create_consent_policy",
    recordId,
    details: {
      policyId: policy.policyId,
      recipient: policy.recipient,
      purpose: policy.purpose,
      dataScope: policy.dataScope,
      policyHash: policy.policyHash
    }
  });

  return { policy, valid: validateConsentPolicy(policy) };
}

async function revokeConsentPolicy({ policyId, actor }) {
  const consentPolicies = await readJson(CONSENT_POLICIES_PATH, []);
  const policyIndex = consentPolicies.findIndex((policy) => policy.policyId === policyId);

  if (policyIndex === -1) {
    throw new Error("Consent policy not found.");
  }

  const currentPolicy = consentPolicies[policyIndex];
  const revokedPolicy = buildConsentPolicy({
    ...currentPolicy,
    status: "revoked",
    revokedAt: new Date().toISOString()
  });
  const nextPolicies = [...consentPolicies];
  nextPolicies[policyIndex] = revokedPolicy;
  await writeJson(CONSENT_POLICIES_PATH, nextPolicies);
  await appendAuditEvent({
    actor: actor || currentPolicy.owner,
    action: "revoke_consent_policy",
    recordId: currentPolicy.recordId,
    details: {
      policyId,
      policyHash: revokedPolicy.policyHash
    }
  });

  return { policy: revokedPolicy, valid: validateConsentPolicy(revokedPolicy) };
}

async function evaluateAccessRequest({
  recordId,
  actor,
  recipient,
  purpose,
  dataScope
}) {
  const consentPolicies = await readJson(CONSENT_POLICIES_PATH, []);
  const policies = consentPolicies.filter((policy) => policy.recordId === recordId);
  const now = new Date().toISOString();
  const decision = policies
    .map((policy) => ({
      policy,
      result: canAccessWithPolicy(policy, { recipient, purpose, dataScope, now })
    }))
    .find((item) => item.result.allowed) || {
      policy: policies[0] || null,
      result: { allowed: false, reason: policies.length === 0 ? "no_policy" : "no_policy_allows_request" }
    };
  const accessRequest = {
    requestId: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    recordId,
    actor: actor || recipient,
    recipient,
    purpose,
    dataScope,
    decision: decision.result.allowed ? "approved" : "denied",
    reason: decision.result.reason,
    policyId: decision.policy ? decision.policy.policyId : null,
    timestamp: now
  };
  const accessRequests = await readJson(ACCESS_REQUESTS_PATH, []);
  await writeJson(ACCESS_REQUESTS_PATH, [accessRequest, ...accessRequests]);
  await appendAuditEvent({
    actor: actor || recipient,
    action: "evaluate_access_request",
    recordId,
    details: accessRequest
  });

  return accessRequest;
}
```

- [ ] **Step 5: Add HTTP routes**

In `handleRequest`, add before `/api/verify`:

```js
if (request.method === "POST" && url.pathname === "/api/consent-policies") {
  const body = await readRequestJson(request);
  sendJson(response, 201, await createConsentPolicyFromRequest(body));
  return;
}

if (request.method === "POST" && url.pathname === "/api/consent-policies/revoke") {
  const body = await readRequestJson(request);
  sendJson(response, 200, await revokeConsentPolicy(body));
  return;
}

if (request.method === "POST" && url.pathname === "/api/access-requests") {
  const body = await readRequestJson(request);
  sendJson(response, 200, await evaluateAccessRequest(body));
  return;
}
```

In `/api/records`, read and return:

```js
const consentPolicies = await readJson(CONSENT_POLICIES_PATH, []);
const accessRequests = await readJson(ACCESS_REQUESTS_PATH, []);
```

and add to response:

```js
consentPolicies,
accessRequests,
```

- [ ] **Step 6: Export helpers**

Add to `module.exports`:

```js
createConsentPolicyFromRequest,
evaluateAccessRequest,
revokeConsentPolicy,
```

- [ ] **Step 7: Run tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 8: Smoke-test API**

Start server:

```powershell
npm start
```

In a second terminal:

```powershell
$records = Invoke-RestMethod -Uri 'http://localhost:3000/api/records' -Method Get
$recordId = $records.records[0].recordId
$policy = Invoke-RestMethod -Uri 'http://localhost:3000/api/consent-policies' -Method Post -ContentType 'application/json' -Body (@{
  recordId = $recordId
  actor = 'demo-user'
  recipient = 'research-admin'
  purpose = 'research'
  dataScope = 'derived-summary'
} | ConvertTo-Json)
$request = Invoke-RestMethod -Uri 'http://localhost:3000/api/access-requests' -Method Post -ContentType 'application/json' -Body (@{
  recordId = $recordId
  actor = 'research-admin'
  recipient = 'research-admin'
  purpose = 'research'
  dataScope = 'derived-summary'
} | ConvertTo-Json)
$request.decision
```

Expected:

```text
approved
```

- [ ] **Step 9: Commit**

```powershell
git add neuroproof-prototype/server.js neuroproof-prototype/test/server.test.js
git commit -m "feat: add purpose-bound consent API"
```

---

### Task 3: Add Raw-vs-Derived Neurodata Risk Labels

**Files:**
- Create: `neuroproof-prototype/lib/risk-labels.js`
- Modify: `neuroproof-prototype/server.js`
- Modify: `neuroproof-prototype/public/index.html`
- Modify: `neuroproof-prototype/public/app.js`
- Modify: `neuroproof-prototype/public/styles.css`
- Test: `neuroproof-prototype/test/server.test.js`

- [ ] **Step 1: Write failing tests**

Append to `test/server.test.js`:

```js
const { riskLabelsForAnalysis } = require("../lib/risk-labels");

test("riskLabelsForAnalysis separates raw and derived neurodata risks", () => {
  const labels = riskLabelsForAnalysis({
    bandSummary: {
      thetaMean: 10,
      alphaMean: 18,
      betaMean: 13,
      focusIndex: 0.72,
      relaxationIndex: 0.78
    }
  });

  assert.equal(labels.some((label) => label.scope === "raw-eeg"), true);
  assert.equal(labels.some((label) => label.scope === "derived-inference"), true);
  assert.equal(labels.find((label) => label.field === "focusIndex").riskLevel, "medium");
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm test
```

Expected: FAIL with `Cannot find module '../lib/risk-labels'`.

- [ ] **Step 3: Create risk label module**

Create `neuroproof-prototype/lib/risk-labels.js`:

```js
function riskLabelsForAnalysis(analysis) {
  const labels = [
    {
      field: "raw EEG CSV",
      scope: "raw-eeg",
      riskLevel: "high",
      explanation: "Raw EEG may support identity, health, attention, emotional, or private attribute inference."
    }
  ];

  if (analysis && analysis.bandSummary) {
    if (Number.isFinite(analysis.bandSummary.focusIndex)) {
      labels.push({
        field: "focusIndex",
        scope: "derived-inference",
        riskLevel: "medium",
        explanation: "Focus-like scores are derived neurodata and may be misused for productivity or attention monitoring."
      });
    }
    if (Number.isFinite(analysis.bandSummary.relaxationIndex)) {
      labels.push({
        field: "relaxationIndex",
        scope: "derived-inference",
        riskLevel: "medium",
        explanation: "Relaxation-like scores are derived neurodata and may imply mental state."
      });
    }
    for (const field of ["thetaMean", "alphaMean", "betaMean"]) {
      if (Number.isFinite(analysis.bandSummary[field])) {
        labels.push({
          field,
          scope: "derived-summary",
          riskLevel: "low",
          explanation: "Aggregated band summaries are less sensitive than raw EEG but still derived from brain activity."
        });
      }
    }
  }

  return labels;
}

module.exports = { riskLabelsForAnalysis };
```

- [ ] **Step 4: Add labels to record response**

In `server.js`, import:

```js
const { riskLabelsForAnalysis } = require("./lib/risk-labels");
```

In `createRecord`, add to `record`:

```js
riskLabels: riskLabelsForAnalysis(analysis)
```

In `/api/records`, normalize old records before response:

```js
const recordsWithRiskLabels = records.map((record) => ({
  ...record,
  riskLabels: record.riskLabels || riskLabelsForAnalysis(record.analysis)
}));
```

Return `records: recordsWithRiskLabels` instead of `records`.

- [ ] **Step 5: Render labels in User detail**

In `public/index.html`, add inside the `선택 기록 분석` section after `recordDetail`:

```html
<div id="riskLabels" class="riskLabels"></div>
```

In `public/app.js`, add:

```js
const riskLabelsEl = document.querySelector("#riskLabels");
```

Add this function:

```js
function renderRiskLabels(record) {
  riskLabelsEl.innerHTML = "";
  if (!record || !record.riskLabels) {
    riskLabelsEl.innerHTML = "<p class=\"empty\">위험 라벨이 없습니다.</p>";
    return;
  }

  for (const label of record.riskLabels) {
    const item = document.createElement("article");
    item.className = `riskLabel ${label.riskLevel}`;
    item.innerHTML = `
      <div>
        <h3>${label.field}</h3>
        <p>${label.scope} / ${label.riskLevel}</p>
      </div>
      <p>${label.explanation}</p>
    `;
    riskLabelsEl.append(item);
  }
}
```

Call `renderRiskLabels(record);` in `renderRecordDetail()` after `const record = selectedRecord();`. For the no-record branch, call `renderRiskLabels(null);`.

- [ ] **Step 6: Add styles**

Add to `public/styles.css`:

```css
.riskLabels {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}

.riskLabel {
  display: grid;
  grid-template-columns: minmax(160px, 0.6fr) minmax(260px, 1.4fr);
  gap: 14px;
  border-top: 1px solid #e3e8eb;
  padding-top: 12px;
}

.riskLabel.high {
  border-top-color: #d46a6a;
}

.riskLabel.medium {
  border-top-color: #d9b44a;
}

.riskLabel.low {
  border-top-color: #9dd4b4;
}
```

- [ ] **Step 7: Run tests and browser check**

Run:

```powershell
npm test
```

Expected: PASS.

Start server and check browser:

```powershell
npm start
```

Expected: User detail panel shows raw EEG and derived inference risk labels.

- [ ] **Step 8: Commit**

```powershell
git add neuroproof-prototype/lib/risk-labels.js neuroproof-prototype/server.js neuroproof-prototype/public neuroproof-prototype/test/server.test.js
git commit -m "feat: show raw and derived neurodata risks"
```

---

### Task 4: Add Consent UI And Admin Access Request UI

**Files:**
- Modify: `neuroproof-prototype/public/index.html`
- Modify: `neuroproof-prototype/public/app.js`
- Modify: `neuroproof-prototype/public/styles.css`

- [ ] **Step 1: Add User consent form**

In `public/index.html`, add this section inside `#userView` after the selected record analysis section:

```html
<section class="panel wide">
  <div class="sectionHeader">
    <h2>동의 정책</h2>
    <span class="hint">수신자, 목적, 데이터 범위를 명시합니다.</span>
  </div>
  <div class="consentForm">
    <label>
      수신자
      <select id="consentRecipient">
        <option value="research-admin">research-admin</option>
        <option value="doctor">doctor</option>
        <option value="marketing-company">marketing-company</option>
        <option value="employer">employer</option>
      </select>
    </label>
    <label>
      목적
      <select id="consentPurpose">
        <option value="research">research</option>
        <option value="medical">medical</option>
        <option value="wellness">wellness</option>
        <option value="marketing">marketing</option>
        <option value="employer">employer</option>
      </select>
    </label>
    <label>
      데이터 범위
      <select id="consentScope">
        <option value="derived-summary">derived-summary</option>
        <option value="derived-inference">derived-inference</option>
        <option value="raw-eeg">raw-eeg</option>
      </select>
    </label>
    <div class="actions wrap">
      <button id="createPolicyButton" type="button">동의 정책 생성</button>
      <button id="requestAccessButton" type="button" class="secondary">접근 요청 시뮬레이션</button>
    </div>
  </div>
  <p id="consentMessage" class="message"></p>
</section>
```

- [ ] **Step 2: Add Admin panels**

In `#adminView`, add before audit logs:

```html
<section class="panel wide">
  <div class="sectionHeader">
    <h2>동의 정책 목록</h2>
    <span class="hint">검증 가능한 동의와 철회 상태입니다.</span>
  </div>
  <div id="consentPolicies" class="consentPolicies"></div>
</section>

<section class="panel wide">
  <div class="sectionHeader">
    <h2>접근 요청 결과</h2>
    <span class="hint">목적과 데이터 범위가 정책과 맞는지 평가합니다.</span>
  </div>
  <div id="accessRequests" class="accessRequests"></div>
</section>
```

- [ ] **Step 3: Wire state in app.js**

Add selectors:

```js
const consentRecipient = document.querySelector("#consentRecipient");
const consentPurpose = document.querySelector("#consentPurpose");
const consentScope = document.querySelector("#consentScope");
const createPolicyButton = document.querySelector("#createPolicyButton");
const requestAccessButton = document.querySelector("#requestAccessButton");
const consentMessage = document.querySelector("#consentMessage");
const consentPoliciesEl = document.querySelector("#consentPolicies");
const accessRequestsEl = document.querySelector("#accessRequests");
```

Add state:

```js
let consentPolicies = [];
let accessRequests = [];
```

In `loadRecords()`, add:

```js
consentPolicies = data.consentPolicies || [];
accessRequests = data.accessRequests || [];
renderConsentPolicies();
renderAccessRequests();
```

- [ ] **Step 4: Add render and action functions**

Add to `public/app.js`:

```js
function renderConsentPolicies() {
  consentPoliciesEl.innerHTML = "";
  if (consentPolicies.length === 0) {
    consentPoliciesEl.innerHTML = "<p class=\"empty\">아직 동의 정책이 없습니다.</p>";
    return;
  }

  for (const policy of consentPolicies) {
    const item = document.createElement("article");
    item.className = `policyItem ${policy.status}`;
    item.innerHTML = `
      <div>
        <h3>${policy.recipient}</h3>
        <p>${policy.purpose} / ${policy.dataScope} / ${policy.status}</p>
      </div>
      <div class="hashes">
        <span>Record ${policy.recordId}</span>
        <span>Policy ${shortHash(policy.policyHash)}</span>
        <span>Expires ${new Date(policy.expiresAt).toLocaleDateString()}</span>
      </div>
      <button class="secondary revokePolicyButton" type="button" data-policy-id="${policy.policyId}">동의 철회</button>
    `;
    consentPoliciesEl.append(item);
  }
}

function renderAccessRequests() {
  accessRequestsEl.innerHTML = "";
  if (accessRequests.length === 0) {
    accessRequestsEl.innerHTML = "<p class=\"empty\">아직 접근 요청이 없습니다.</p>";
    return;
  }

  for (const request of accessRequests) {
    const item = document.createElement("article");
    item.className = `requestItem ${request.decision}`;
    item.innerHTML = `
      <div>
        <h3>${request.recipient}</h3>
        <p>${request.purpose} / ${request.dataScope}</p>
      </div>
      <div class="hashes">
        <span>Decision ${request.decision}</span>
        <span>Reason ${request.reason}</span>
        <span>Policy ${request.policyId || "-"}</span>
      </div>
    `;
    accessRequestsEl.append(item);
  }
}

async function createConsentPolicy() {
  const record = selectedRecord();
  if (!record) {
    consentMessage.textContent = "기록을 선택하세요.";
    consentMessage.className = "message dangerText";
    return;
  }

  const result = await postJson("/api/consent-policies", {
    recordId: record.recordId,
    actor: ownerInput.value,
    recipient: consentRecipient.value,
    purpose: consentPurpose.value,
    dataScope: consentScope.value
  });
  consentMessage.textContent = `동의 정책 생성: ${shortHash(result.policy.policyHash)}`;
  consentMessage.className = result.valid ? "message okText" : "message dangerText";
  await loadRecords();
}

async function requestAccess() {
  const record = selectedRecord();
  if (!record) {
    consentMessage.textContent = "기록을 선택하세요.";
    consentMessage.className = "message dangerText";
    return;
  }

  const result = await postJson("/api/access-requests", {
    recordId: record.recordId,
    actor: consentRecipient.value,
    recipient: consentRecipient.value,
    purpose: consentPurpose.value,
    dataScope: consentScope.value
  });
  consentMessage.textContent = `접근 요청: ${result.decision} / ${result.reason}`;
  consentMessage.className = result.decision === "approved" ? "message okText" : "message dangerText";
  await loadRecords();
}
```

Add listeners:

```js
createPolicyButton.addEventListener("click", createConsentPolicy);
requestAccessButton.addEventListener("click", requestAccess);
consentPoliciesEl.addEventListener("click", async (event) => {
  if (!event.target.matches(".revokePolicyButton")) {
    return;
  }
  const result = await postJson("/api/consent-policies/revoke", {
    policyId: event.target.dataset.policyId,
    actor: ownerInput.value
  });
  consentMessage.textContent = `동의 철회: ${shortHash(result.policy.policyHash)}`;
  consentMessage.className = result.valid ? "message okText" : "message dangerText";
  await loadRecords();
});
```

- [ ] **Step 5: Add styles**

Add to `public/styles.css`:

```css
.consentForm {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.consentPolicies,
.accessRequests {
  display: grid;
  gap: 12px;
}

.policyItem,
.requestItem {
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(320px, 1.4fr) minmax(120px, 0.3fr);
  gap: 16px;
  align-items: center;
  border-top: 1px solid #e3e8eb;
  padding-top: 16px;
}

.policyItem.active,
.requestItem.approved {
  border-top-color: #9dd4b4;
}

.policyItem.revoked,
.requestItem.denied {
  border-top-color: #e0a4a4;
}
```

In the mobile media query, add:

```css
.consentForm,
.policyItem,
.requestItem {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 6: Browser test**

Run server:

```powershell
npm start
```

Expected flow:

1. Open `http://localhost:3000`.
2. Select a record.
3. Create a `research` / `derived-summary` policy.
4. Click access request simulation. Expected message: `approved`.
5. Change purpose to `marketing`.
6. Click access request simulation. Expected message: `denied`.
7. Open Admin tab. Expected: policy and access request lists render.

- [ ] **Step 7: Commit**

```powershell
git add neuroproof-prototype/public
git commit -m "feat: add consent policy UI"
```

---

### Task 5: Add Toy Secret-Sharing Aggregate Demo

**Files:**
- Create: `neuroproof-prototype/lib/secret-sharing-demo.js`
- Modify: `neuroproof-prototype/server.js`
- Modify: `neuroproof-prototype/public/index.html`
- Modify: `neuroproof-prototype/public/app.js`
- Modify: `neuroproof-prototype/public/styles.css`
- Test: `neuroproof-prototype/test/server.test.js`

- [ ] **Step 1: Write failing tests**

Append to `test/server.test.js`:

```js
const {
  splitIntoShares,
  reconstructShares,
  buildSecretSharingDemo
} = require("../lib/secret-sharing-demo");

test("secret sharing demo reconstructs aggregate without storing original value in shares", () => {
  const shares = splitIntoShares(1846, 3, 42);

  assert.equal(shares.length, 3);
  assert.equal(shares.some((share) => share === 1846), false);
  assert.equal(reconstructShares(shares), 1846);
});

test("buildSecretSharingDemo creates alpha beta theta share transcript", () => {
  const demo = buildSecretSharingDemo({
    thetaMean: 10.0417,
    alphaMean: 18.4583,
    betaMean: 13.3917
  });

  assert.equal(demo.fields.length, 3);
  assert.equal(demo.fields.every((field) => field.reconstructed === field.scaledValue), true);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test
```

Expected: FAIL with `Cannot find module '../lib/secret-sharing-demo'`.

- [ ] **Step 3: Create module**

Create `neuroproof-prototype/lib/secret-sharing-demo.js`:

```js
function seededNoise(seed, index) {
  const x = Math.sin(seed + index * 101) * 10000;
  return Math.floor((x - Math.floor(x)) * 1000);
}

function splitIntoShares(value, partyCount, seed = 1) {
  const shares = [];
  let sum = 0;

  for (let index = 0; index < partyCount - 1; index += 1) {
    const share = seededNoise(seed, index);
    shares.push(share);
    sum += share;
  }

  shares.push(value - sum);
  return shares;
}

function reconstructShares(shares) {
  return shares.reduce((sum, share) => sum + share, 0);
}

function buildSecretSharingDemo(bandSummary) {
  const values = [
    ["thetaMean", bandSummary.thetaMean],
    ["alphaMean", bandSummary.alphaMean],
    ["betaMean", bandSummary.betaMean]
  ];

  return {
    demoType: "toy_additive_secret_sharing",
    disclaimer: "Educational demo only. It illustrates the SMC idea but is not production cryptography.",
    fields: values.map(([field, value], index) => {
      const scaledValue = Math.round(Number(value) * 100);
      const shares = splitIntoShares(scaledValue, 3, index + 7);
      return {
        field,
        scaledValue,
        shares,
        reconstructed: reconstructShares(shares)
      };
    })
  };
}

module.exports = {
  buildSecretSharingDemo,
  reconstructShares,
  splitIntoShares
};
```

- [ ] **Step 4: Add server endpoint**

In `server.js`, import:

```js
const { buildSecretSharingDemo } = require("./lib/secret-sharing-demo");
```

Add function:

```js
async function readSecretSharingDemo(recordId) {
  const records = await readJson(RECORDS_PATH, []);
  const record = records.find((item) => item.recordId === recordId);

  if (!record) {
    throw new Error("Record not found.");
  }

  await appendAuditEvent({
    actor: "system",
    action: "run_secret_sharing_demo",
    recordId,
    details: {
      fields: ["thetaMean", "alphaMean", "betaMean"]
    }
  });

  return buildSecretSharingDemo(record.analysis.bandSummary || {});
}
```

Add route before `/sample/`:

```js
if (request.method === "GET" && url.pathname.startsWith("/api/secret-sharing-demo/")) {
  const recordId = decodeURIComponent(url.pathname.replace(/^\/api\/secret-sharing-demo\//, ""));
  sendJson(response, 200, await readSecretSharingDemo(recordId));
  return;
}
```

- [ ] **Step 5: Add UI panel**

In `#adminView`, add:

```html
<section class="panel wide">
  <div class="sectionHeader">
    <h2>프라이버시 보존 분석 데모</h2>
    <button id="secretSharingButton" type="button" class="secondary">Secret-sharing 데모</button>
  </div>
  <div id="secretSharingResult" class="secretSharingResult"></div>
</section>
```

In `app.js`, add selectors:

```js
const secretSharingButton = document.querySelector("#secretSharingButton");
const secretSharingResultEl = document.querySelector("#secretSharingResult");
```

Add function:

```js
async function runSecretSharingDemo() {
  const record = selectedRecord();
  if (!record) {
    secretSharingResultEl.innerHTML = "<p class=\"empty\">기록을 선택하세요.</p>";
    return;
  }

  const demo = await getJson(`/api/secret-sharing-demo/${encodeURIComponent(record.recordId)}`);
  secretSharingResultEl.innerHTML = `
    <p class="message">${demo.disclaimer}</p>
    ${demo.fields.map((field) => `
      <article class="shareRow">
        <div>
          <h3>${field.field}</h3>
          <p>scaled ${field.scaledValue} / reconstructed ${field.reconstructed}</p>
        </div>
        <div class="hashes">
          <span>Party A ${field.shares[0]}</span>
          <span>Party B ${field.shares[1]}</span>
          <span>Party C ${field.shares[2]}</span>
        </div>
      </article>
    `).join("")}
  `;
  await loadRecords();
}
```

Add listener:

```js
secretSharingButton.addEventListener("click", runSecretSharingDemo);
```

- [ ] **Step 6: Add styles**

Add to `styles.css`:

```css
.secretSharingResult {
  display: grid;
  gap: 12px;
}

.shareRow {
  display: grid;
  grid-template-columns: minmax(180px, 0.7fr) minmax(320px, 1.3fr);
  gap: 16px;
  border-top: 1px solid #e3e8eb;
  padding-top: 16px;
}
```

- [ ] **Step 7: Run tests and browser check**

Run:

```powershell
npm test
```

Expected: PASS.

Browser expected: Admin panel shows three party shares for theta/alpha/beta and reconstructs the scaled aggregate.

- [ ] **Step 8: Commit**

```powershell
git add neuroproof-prototype/lib/secret-sharing-demo.js neuroproof-prototype/server.js neuroproof-prototype/public neuroproof-prototype/test/server.test.js
git commit -m "feat: add privacy preserving analysis demo"
```

---

### Task 6: Extend Proof Into User-Readable Privacy Receipt

**Files:**
- Modify: `neuroproof-prototype/server.js`
- Modify: `neuroproof-prototype/public/app.js`
- Modify: `neuroproof-prototype/README.md`
- Test: `neuroproof-prototype/test/server.test.js`

- [ ] **Step 1: Write failing receipt test**

Append to `test/server.test.js`:

```js
test("proof certificate includes privacy receipt fields", () => {
  const analysis = analyzeEegCsv(sample);
  const block = buildLedgerBlock({
    ledger: [],
    recordId: "record-1",
    owner: "demo-user",
    rawHash: sha256Hex(sample),
    analysisHash: sha256Hex(stableStringify(analysis)),
    objectKey: "record-1.csv",
    timestamp: "2026-06-04T00:00:00.000Z"
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
    riskLabels: []
  };

  const proof = buildProofCertificate({
    record,
    block,
    generatedAt: "2026-06-04T00:00:01.000Z"
  });

  assert.equal(proof.privacy.rawDataLocation, "off-chain");
  assert.equal(proof.privacy.onChainData, "hashes_and_events_only");
  assert.equal(Array.isArray(proof.privacy.userRights), true);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm test
```

Expected: FAIL because `proof.privacy` is missing.

- [ ] **Step 3: Update certificate builder**

In `server.js`, inside `buildProofCertificate`, add this top-level property:

```js
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
  riskSummary: record.riskLabels || []
}
```

- [ ] **Step 4: Update UI download message**

In `public/app.js`, after `downloadJson(...)`, set:

```js
accessMessage.textContent = "프라이버시 영수증 다운로드 완료";
accessMessage.className = "message okText";
```

- [ ] **Step 5: Update README**

Add under role separation:

```markdown
- 프라이버시 영수증 역할: 증명서 JSON은 원본 EEG가 오프체인에 있고, 온체인에는 해시와 이벤트만 남는다는 점을 명시합니다.
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add neuroproof-prototype/server.js neuroproof-prototype/public/app.js neuroproof-prototype/README.md neuroproof-prototype/test/server.test.js
git commit -m "feat: extend proof into privacy receipt"
```

---

## Final Verification

- [ ] Run the complete test suite:

```powershell
npm test
```

Expected: all tests pass.

- [ ] Start the app:

```powershell
npm start
```

- [ ] Verify User flow:

1. Upload sample EEG.
2. View raw/derived risk labels.
3. Create a consent policy for `research-admin`, `research`, `derived-summary`.
4. Simulate access request. Expected: approved.
5. Change purpose to `marketing`. Expected: denied.
6. Download privacy receipt.

- [ ] Verify Admin flow:

1. View full records.
2. View blockchain-style ledger.
3. View consent policies.
4. View access request decisions.
5. View audit log.
6. Run tamper simulation.
7. Run secret-sharing demo.

## Self-Review

**Spec coverage:** The plan covers consent, revocation, purpose limitation, transparency, raw-vs-derived neurodata, off-chain storage, auditability, and privacy-preserving analysis demonstration.

**Placeholder scan:** No `TBD`, `TODO`, or undefined “implement later” items remain.

**Type consistency:** Policy fields use `policyId`, `recordId`, `recipient`, `purpose`, `dataScope`, `status`, `policyHash`. Access request fields use `requestId`, `decision`, and `reason`. These names are consistent across tests, server, and UI.
