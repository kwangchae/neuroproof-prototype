const uploadForm = document.querySelector("#uploadForm");
const verifyForm = document.querySelector("#verifyForm");
const fileInput = document.querySelector("#fileInput");
const verifyFileInput = document.querySelector("#verifyFileInput");
const ownerInput = document.querySelector("#ownerInput");
const uploadMessage = document.querySelector("#uploadMessage");
const verifyMessage = document.querySelector("#verifyMessage");
const accessMessage = document.querySelector("#accessMessage");
const recordsEl = document.querySelector("#records");
const recordSelect = document.querySelector("#recordSelect");
const flowStepUpload = document.querySelector("#flowStepUpload");
const flowStepVerify = document.querySelector("#flowStepVerify");
const flowStepConsent = document.querySelector("#flowStepConsent");
const flowStepReceipt = document.querySelector("#flowStepReceipt");
const ledgerStatus = document.querySelector("#ledgerStatus");
const auditStatus = document.querySelector("#auditStatus");
const runtimeCardsEl = document.querySelector("#runtimeCards");
const sampleButton = document.querySelector("#sampleButton");
const refreshButton = document.querySelector("#refreshButton");
const verifyStoredButton = document.querySelector("#verifyStoredButton");
const verifyTamperedButton = document.querySelector("#verifyTamperedButton");
const uploadEvidence = document.querySelector("#uploadEvidence");
const ledgerBlocksEl = document.querySelector("#ledgerBlocks");
const recordDetailEl = document.querySelector("#recordDetail");
const riskLabelsEl = document.querySelector("#riskLabels");
const downloadProofButton = document.querySelector("#downloadProofButton");
const grantAccessButton = document.querySelector("#grantAccessButton");
const revokeAccessButton = document.querySelector("#revokeAccessButton");
const userTab = document.querySelector("#userTab");
const adminTab = document.querySelector("#adminTab");
const userView = document.querySelector("#userView");
const adminView = document.querySelector("#adminView");
const adminFilterButtons = document.querySelectorAll(".adminFilter");
const adminSections = document.querySelectorAll("[data-admin-section]");
const systemMetricsEl = document.querySelector("#systemMetrics");
const governanceSummaryEl = document.querySelector("#governanceSummary");
const auditEventsEl = document.querySelector("#auditEvents");
const accessGrantsEl = document.querySelector("#accessGrants");
const consentPoliciesEl = document.querySelector("#consentPolicies");
const accessRequestsEl = document.querySelector("#accessRequests");
const blockchainReceiptsEl = document.querySelector("#blockchainReceipts");
const consentRecipient = document.querySelector("#consentRecipient");
const consentPurpose = document.querySelector("#consentPurpose");
const consentScope = document.querySelector("#consentScope");
const createPolicyButton = document.querySelector("#createPolicyButton");
const requestAccessButton = document.querySelector("#requestAccessButton");
const revokePolicyButton = document.querySelector("#revokePolicyButton");
const consentMessage = document.querySelector("#consentMessage");
const secretSharingButton = document.querySelector("#secretSharingButton");
const secretSharingResult = document.querySelector("#secretSharingResult");
const simulateLedgerButton = document.querySelector("#simulateLedgerButton");
const simulateAuditButton = document.querySelector("#simulateAuditButton");
const tamperSimulationResultEl = document.querySelector("#tamperSimulationResult");

let records = [];
let ledger = [];
let auditLog = [];
let accessGrants = [];
let consentPolicies = [];
let accessRequests = [];
let blockchainReceipts = [];
let adminFilter = "summary";
let runtime = {};

async function readFileText(file) {
  if (!file) {
    throw new Error("CSV 파일을 선택하세요.");
  }
  return file.text();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "요청에 실패했습니다.");
  }
  return body;
}

async function getJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "요청에 실패했습니다.");
  }
  return body;
}

function shortHash(hash) {
  const value = String(hash || "");
  if (!value) {
    return "-";
  }
  if (value.length <= 22) {
    return value;
  }
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function downloadJson(fileName, payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function providerLabel(status) {
  if (!status) {
    return "-";
  }

  const suffix = status.configured ? "" : " / 설정 필요";
  return `${status.provider || "-"} / ${status.mode || "-"}${suffix}`;
}

function runtimeDetail(status, fallback = "-") {
  if (!status) {
    return fallback;
  }
  return status.table || status.bucket || status.contractAddress || status.networkName || fallback;
}

function txExplorerUrl(receipt) {
  if (!receipt || !receipt.txHash) {
    return "";
  }

  const networkName = receipt.networkName || (runtime.blockchain && runtime.blockchain.networkName);
  if (networkName === "sepolia") {
    return `https://sepolia.etherscan.io/tx/${receipt.txHash}`;
  }
  return "";
}

function txLink(receipt) {
  if (!receipt || !receipt.txHash) {
    return "-";
  }

  const label = shortHash(receipt.txHash);
  const url = txExplorerUrl(receipt);
  if (!url) {
    return escapeHtml(label);
  }
  return `<a class="externalLink" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function latestReceiptForRecordUi(recordId, eventName) {
  return blockchainReceipts.find((receipt) =>
    receipt.recordId === recordId && (!eventName || receipt.eventName === eventName)
  ) || null;
}

function renderLedgerStatus(valid) {
  ledgerStatus.textContent = valid ? "원장 정상" : "원장 손상 감지";
  ledgerStatus.className = valid ? "status ok" : "status danger";
}

function renderAuditStatus(valid) {
  auditStatus.textContent = valid ? "감사 로그 정상" : "감사 로그 손상";
  auditStatus.className = valid ? "status ok" : "status danger";
}

function renderRuntimeCards() {
  if (!runtimeCardsEl) {
    return;
  }

  const metadata = runtime.metadata || null;
  const storage = runtime.storage || null;
  const blockchain = runtime.blockchain || null;
  const cards = [
    {
      label: "Metadata",
      value: providerLabel(metadata),
      detail: metadata && metadata.table ? `Table ${metadata.table}` : runtimeDetail(metadata, "local JSON"),
      ok: !metadata || metadata.configured
    },
    {
      label: "Cloud Storage",
      value: providerLabel(storage),
      detail: storage && storage.bucket ? `Bucket ${storage.bucket}` : runtimeDetail(storage, "local object store"),
      ok: !storage || storage.configured
    },
    {
      label: "Blockchain",
      value: providerLabel(blockchain),
      detail: blockchain && blockchain.contractAddress
        ? `${blockchain.networkName} / ${shortHash(blockchain.contractAddress)}`
        : runtimeDetail(blockchain, "mock chain"),
      ok: !blockchain || blockchain.configured
    }
  ];

  runtimeCardsEl.innerHTML = cards.map((card) => `
    <article class="runtimeCard ${card.ok ? "ok" : "missing"}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <p>${escapeHtml(card.detail)}</p>
    </article>
  `).join("");
}

function switchView(viewName) {
  const isAdmin = viewName === "admin";
  userTab.classList.toggle("active", !isAdmin);
  adminTab.classList.toggle("active", isAdmin);
  userTab.setAttribute("aria-selected", String(!isAdmin));
  adminTab.setAttribute("aria-selected", String(isAdmin));
  userView.classList.toggle("active", !isAdmin);
  adminView.classList.toggle("active", isAdmin);
  if (isAdmin) {
    applyAdminFilter();
  }
}

function applyAdminFilter() {
  for (const button of adminFilterButtons) {
    const active = button.dataset.adminFilter === adminFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  for (const section of adminSections) {
    section.hidden = adminFilter !== "all" && section.dataset.adminSection !== adminFilter;
  }
}

function renderRecordOptions() {
  recordSelect.innerHTML = "";
  if (records.length === 0) {
    const option = document.createElement("option");
    option.textContent = "검증할 기록 없음";
    option.value = "";
    recordSelect.append(option);
    return;
  }

  for (const record of records) {
    const option = document.createElement("option");
    option.value = record.recordId;
    option.textContent = `${record.fileName} / ${shortHash(record.rawHash)}`;
    recordSelect.append(option);
  }
}

function selectedRecord() {
  return records.find((record) => record.recordId === recordSelect.value);
}

function latestActiveGrantForRecord(recordId) {
  return accessGrants.find((grant) => grant.recordId === recordId && grant.status === "active");
}

function latestPolicyForRecord(recordId) {
  return consentPolicies.find((policy) => policy.recordId === recordId);
}

function latestActivePolicyForRecord(recordId) {
  return consentPolicies.find((policy) => policy.recordId === recordId && policy.status === "active");
}

function selectedGrant() {
  const record = selectedRecord();
  return record ? latestActiveGrantForRecord(record.recordId) : null;
}

function latestActiveConsentPolicy() {
  const record = selectedRecord();
  if (!record) {
    return null;
  }

  return consentPolicies.find((policy) =>
    policy.recordId === record.recordId &&
    policy.status === "active" &&
    policy.recipient === consentRecipient.value.trim() &&
    policy.purpose === consentPurpose.value &&
    policy.dataScope === consentScope.value
  );
}

function syncConsentButtons() {
  const hasRecord = Boolean(selectedRecord());
  createPolicyButton.disabled = !hasRecord;
  requestAccessButton.disabled = !hasRecord;
  revokePolicyButton.disabled = !latestActiveConsentPolicy();
}

function setFlowStep(element, state) {
  element.classList.toggle("done", state === "done");
  element.classList.toggle("active", state === "active");
}

function renderFlowGuide() {
  const record = selectedRecord();
  const hasRecord = Boolean(record);
  const hasPolicy = record ? Boolean(latestActivePolicyForRecord(record.recordId)) : false;
  const hasApprovedRequest = record
    ? accessRequests.some((request) => request.recordId === record.recordId && request.decision === "approved")
    : false;

  setFlowStep(flowStepUpload, hasRecord ? "done" : "active");
  setFlowStep(flowStepVerify, hasRecord ? "done" : "pending");
  setFlowStep(flowStepConsent, hasPolicy || hasApprovedRequest ? "done" : hasRecord ? "active" : "pending");
  setFlowStep(flowStepReceipt, hasRecord && hasPolicy ? "active" : "pending");
}

function renderRecords() {
  recordsEl.innerHTML = "";

  if (records.length === 0) {
    recordsEl.innerHTML = "<p class=\"empty\">아직 기록된 EEG 데이터가 없습니다.</p>";
    renderRecordOptions();
    return;
  }

  for (const record of records) {
    const summary = record.analysis.bandSummary || {};
    const item = document.createElement("article");
    item.className = "record";
    item.innerHTML = `
      <div>
        <h3>${record.fileName}</h3>
        <p>${new Date(record.timestamp).toLocaleString()} / ${record.owner}</p>
      </div>
      <dl>
        <div><dt>행</dt><dd>${record.analysis.rowCount}</dd></div>
        <div><dt>채널</dt><dd>${record.analysis.channelCount}</dd></div>
        <div><dt>Focus</dt><dd>${summary.focusIndex ?? "-"}</dd></div>
        <div><dt>Relax</dt><dd>${summary.relaxationIndex ?? "-"}</dd></div>
      </dl>
      <div class="hashes">
        <span>Raw ${shortHash(record.rawHash)}</span>
        <span>Result ${shortHash(record.analysisHash)}</span>
        <span>Block ${shortHash(record.blockHash)}</span>
      </div>
    `;
    recordsEl.append(item);
  }

  renderRecordOptions();
}

function riskLevelLabel(level) {
  return {
    high: "높음",
    medium: "중간",
    low: "낮음"
  }[level] || level;
}

function renderRiskLabels(record) {
  if (!record || !Array.isArray(record.riskLabels) || record.riskLabels.length === 0) {
    riskLabelsEl.innerHTML = "";
    return;
  }

  riskLabelsEl.innerHTML = `
    <h3>프라이버시 위험 라벨</h3>
    <div class="riskLabelGrid">
      ${record.riskLabels.map((label) => `
        <article class="riskLabel ${label.level}">
          <div>
            <strong>${label.title}</strong>
            <span>${riskLevelLabel(label.level)}</span>
          </div>
          <p>${label.description}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function renderAccessPolicySummary(record) {
  const grant = latestActiveGrantForRecord(record.recordId);
  const policy = latestActivePolicyForRecord(record.recordId) || latestPolicyForRecord(record.recordId);

  return `
    <div class="governanceLink">
      <div class="${policy && policy.status === "active" ? "ok" : ""}">
        <span>동의 정책</span>
        <strong>${policy ? `${policy.purpose} / ${policy.dataScope}` : "없음"}</strong>
        <p>${policy ? `${policy.recipient} / ${policy.status}` : "목적 제한 정책을 먼저 만드세요."}</p>
      </div>
      <div class="${grant ? "ok" : ""}">
        <span>접근권</span>
        <strong>${grant ? grant.grantee : "없음"}</strong>
        <p>${grant ? "연구자 접근 가능 상태" : "필요할 때만 별도로 발급하세요."}</p>
      </div>
    </div>
  `;
}

function renderRecordDetail() {
  const record = selectedRecord();

  if (!record) {
    recordDetailEl.innerHTML = "<p class=\"empty\">분석할 기록을 선택하세요.</p>";
    renderRiskLabels(null);
    downloadProofButton.disabled = true;
    grantAccessButton.disabled = true;
    revokeAccessButton.disabled = true;
    secretSharingButton.disabled = true;
    syncConsentButtons();
    renderFlowGuide();
    return;
  }

  downloadProofButton.disabled = false;
  grantAccessButton.disabled = false;
  revokeAccessButton.disabled = !selectedGrant();
  secretSharingButton.disabled = false;
  syncConsentButtons();
  const summary = record.analysis.bandSummary || {};
  const activeGrant = latestActiveGrantForRecord(record.recordId);
  const bandValues = [
    ["theta", summary.thetaMean],
    ["alpha", summary.alphaMean],
    ["beta", summary.betaMean]
  ].filter(([, value]) => Number.isFinite(value));
  const maxBand = Math.max(...bandValues.map(([, value]) => value), 1);
  const bandRows = bandValues
    .map(([name, value]) => {
      const width = Math.max(4, Math.round((value / maxBand) * 100));
      return `
        <div class="bandRow">
          <span>${name}</span>
          <div class="barTrack"><div class="barFill" style="width: ${width}%"></div></div>
          <strong>${value}</strong>
        </div>
      `;
    })
    .join("");
  const registrationReceipt = latestReceiptForRecordUi(record.recordId, "EEGRecordRegistered");
  const storage = record.storage || {};
  const metadataStatus = runtime.metadata || {};
  const storageStatus = runtime.storage || {};
  const blockchainStatus = runtime.blockchain || {};
  const storageLocation = storage.location || storage.objectKey || record.objectKey || "-";
  const contractDetail = blockchainStatus.contractAddress
    ? `${blockchainStatus.networkName || blockchainStatus.provider} / ${shortHash(blockchainStatus.contractAddress)}`
    : runtimeDetail(blockchainStatus, "mock chain");
  const receiptGas = registrationReceipt && Number.isFinite(Number(registrationReceipt.gasUsed))
    ? Number(registrationReceipt.gasUsed).toLocaleString()
    : "-";
  const receiptDetail = registrationReceipt
    ? `Tx ${txLink(registrationReceipt)} / Block #${registrationReceipt.blockNumber} / Gas ${receiptGas}`
    : "등록 receipt 없음";

  recordDetailEl.innerHTML = `
    <div class="detailGrid">
      <div>
        <h3>${record.fileName}</h3>
        <p>${record.owner} / ${new Date(record.timestamp).toLocaleString()}</p>
        <p class="accessState">${activeGrant ? `접근 허용: ${activeGrant.grantee}` : "접근권 없음"}</p>
        ${renderAccessPolicySummary(record)}
        <div class="hashes detailHashes">
          <span>Raw ${record.rawHash}</span>
          <span>Analysis ${record.analysisHash}</span>
          <span>Block ${record.blockHash}</span>
        </div>
      </div>
      <div class="bandPanel">
        <div class="metricPair">
          <div><span>Focus</span><strong>${summary.focusIndex ?? "-"}</strong></div>
          <div><span>Relax</span><strong>${summary.relaxationIndex ?? "-"}</strong></div>
        </div>
        ${bandRows}
      </div>
    </div>
    <div class="evidenceTrail">
      <div class="evidenceHeader">
        <h3>보관/체인 증거</h3>
        <span class="${registrationReceipt ? "okText" : "dangerText"}">${registrationReceipt ? statusLabel(registrationReceipt) : "receipt 없음"}</span>
      </div>
      <div class="evidenceGrid">
        <div class="evidenceItem">
          <span>Cloud Object</span>
          <strong>${escapeHtml(storage.provider || storageStatus.provider || "-")} / ${escapeHtml(storage.contentType || "text/csv")}</strong>
          <p>${escapeHtml(storageLocation)}</p>
        </div>
        <div class="evidenceItem">
          <span>Metadata</span>
          <strong>${escapeHtml(providerLabel(metadataStatus))}</strong>
          <p>${escapeHtml(runtimeDetail(metadataStatus, "local JSON"))}</p>
        </div>
        <div class="evidenceItem">
          <span>Contract</span>
          <strong>${escapeHtml(providerLabel(blockchainStatus))}</strong>
          <p>${escapeHtml(contractDetail)}</p>
        </div>
        <div class="evidenceItem">
          <span>Transaction</span>
          <strong>${escapeHtml(registrationReceipt ? statusLabel(registrationReceipt) : "-")}</strong>
          <p>${receiptDetail}</p>
        </div>
      </div>
    </div>
  `;
  renderRiskLabels(record);
  renderFlowGuide();
}

function renderLedgerBlocks() {
  ledgerBlocksEl.innerHTML = "";

  if (ledger.length === 0) {
    ledgerBlocksEl.innerHTML = "<p class=\"empty\">아직 원장 블록이 없습니다.</p>";
    return;
  }

  for (const block of [...ledger].reverse()) {
    const item = document.createElement("article");
    item.className = "ledgerBlock";
    item.innerHTML = `
      <div>
        <h3>Block #${block.index}</h3>
        <p>${new Date(block.timestamp).toLocaleString()} / ${block.owner}</p>
      </div>
      <div class="hashes">
        <span>Record ${block.recordId}</span>
        <span>Prev ${shortHash(block.previousHash)}</span>
        <span>Block ${shortHash(block.blockHash)}</span>
      </div>
    `;
    ledgerBlocksEl.append(item);
  }
}

function statusLabel(receipt) {
  if (receipt.isValid === false || receipt.isChainValid === false) {
    return "변조 의심";
  }
  return receipt.status === "success" ? "검증됨" : receipt.status || "기록됨";
}

function eventSummary(receipt) {
  const summaries = {
    EEGRecordRegistered: "EEG 해시 등록",
    ConsentPolicyCreated: "동의 정책 생성",
    ConsentPolicyRevoked: "동의 정책 철회",
    ProofCertificateIssued: "증명서 발급"
  };

  if (receipt.eventName === "AccessRequestEvaluated") {
    return receipt.args && receipt.args.decision === "approved" ? "접근 요청 승인" : "접근 요청 거절";
  }

  return summaries[receipt.eventName] || receipt.eventName;
}

function eventExplanation(receipt) {
  const explanations = {
    EEGRecordRegistered: "원본 EEG는 오프체인에 두고 원본/분석/원장 해시만 이벤트로 고정했습니다.",
    ConsentPolicyCreated: "수신자, 목적, 데이터 범위를 해시로 고정한 접근 정책입니다.",
    ConsentPolicyRevoked: "기존 동의 정책이 철회되어 이후 접근 평가에서 사용할 수 없습니다.",
    ProofCertificateIssued: "검증용 증명서 본문 해시가 트랜잭션 receipt와 연결됐습니다."
  };

  if (receipt.eventName === "AccessRequestEvaluated") {
    return receipt.args && receipt.args.decision === "approved"
      ? "요청 목적과 데이터 범위가 활성 정책과 일치해 승인됐습니다."
      : "요청 목적, 수신자, 데이터 범위 중 하나가 정책과 맞지 않아 거절됐습니다.";
  }

  return explanations[receipt.eventName] || "스마트컨트랙트 호환 이벤트 receipt입니다.";
}

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
        <h3>${eventSummary(receipt)}</h3>
        <p class="receiptEventName">${receipt.eventName}</p>
        <p>${eventExplanation(receipt)}</p>
      </div>
      <div class="hashes">
        <span>${statusLabel(receipt)} / Block #${receipt.blockNumber} / Gas ${Number(receipt.gasUsed).toLocaleString()}</span>
        <span>Tx ${txLink(receipt)}</span>
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

function renderSystemMetrics({ ledgerValid, auditLogValid }) {
  const metadataLabel = runtime.metadata
    ? `${runtime.metadata.provider}${runtime.metadata.configured ? "" : " missing"}`
    : "-";
  const storageLabel = runtime.storage
    ? `${runtime.storage.provider}${runtime.storage.configured ? "" : " missing"}`
    : "-";
  const chainLabel = runtime.blockchain
    ? `${runtime.blockchain.provider}${runtime.blockchain.configured ? "" : " missing"}`
    : "-";

  systemMetricsEl.innerHTML = `
    <div class="metricCards">
      <div><span>Records</span><strong>${records.length}</strong></div>
      <div><span>Blocks</span><strong>${ledger.length}</strong></div>
      <div><span>Audit Events</span><strong>${auditLog.length}</strong></div>
      <div><span>Access Grants</span><strong>${accessGrants.length}</strong></div>
      <div><span>Consent Policies</span><strong>${consentPolicies.length}</strong></div>
      <div><span>Access Requests</span><strong>${accessRequests.length}</strong></div>
      <div><span>Contract Events</span><strong>${blockchainReceipts.length}</strong></div>
      <div><span>Metadata</span><strong>${metadataLabel}</strong></div>
      <div><span>Storage</span><strong>${storageLabel}</strong></div>
      <div><span>Chain</span><strong>${chainLabel}</strong></div>
      <div><span>Integrity</span><strong>${ledgerValid && auditLogValid ? "OK" : "Check"}</strong></div>
    </div>
  `;
}

function renderGovernanceSummary({ ledgerValid, auditLogValid }) {
  const approvedRequests = accessRequests.filter((request) => request.decision === "approved").length;
  const deniedRequests = accessRequests.filter((request) => request.decision === "denied").length;
  const activePolicies = consentPolicies.filter((policy) => policy.status === "active").length;
  const revokedPolicies = consentPolicies.filter((policy) => policy.status === "revoked").length;
  const riskLabelCount = records.reduce((sum, record) => sum + (record.riskLabels || []).length, 0);

  governanceSummaryEl.innerHTML = `
    <div class="summaryCards">
      <article>
        <span>Consent & Revocation</span>
        <strong>${activePolicies} active / ${revokedPolicies} revoked</strong>
        <p>목적, 수신자, 데이터 범위를 해시로 고정합니다.</p>
      </article>
      <article>
        <span>Purpose Limitation</span>
        <strong>${approvedRequests} approved / ${deniedRequests} denied</strong>
        <p>정책과 맞지 않는 요청은 거절 기록으로 남깁니다.</p>
      </article>
      <article>
        <span>Neurodata Risk</span>
        <strong>${riskLabelCount} labels</strong>
        <p>raw EEG와 파생 정신상태 추론 위험을 사용자에게 표시합니다.</p>
      </article>
      <article>
        <span>Auditability</span>
        <strong>${ledgerValid && auditLogValid ? "verified" : "needs check"}</strong>
        <p>원장과 감사 로그가 해시 체인으로 검증됩니다.</p>
      </article>
      <article>
        <span>Private Analysis</span>
        <strong>raw EEG off-chain</strong>
        <p>secret sharing 데모는 원본 대신 파생 요약값만 사용합니다.</p>
      </article>
    </div>
  `;
}

function renderAccessGrants() {
  accessGrantsEl.innerHTML = "";

  if (accessGrants.length === 0) {
    accessGrantsEl.innerHTML = "<p class=\"empty\">아직 접근권이 없습니다.</p>";
    return;
  }

  for (const grant of accessGrants) {
    const item = document.createElement("article");
    item.className = `accessGrant ${grant.status === "active" ? "activeGrant" : ""}`;
    item.innerHTML = `
      <div>
        <h3>${grant.grantee}</h3>
        <p>${grant.status} / ${new Date(grant.createdAt).toLocaleString()}</p>
      </div>
      <div class="hashes">
        <span>Record ${grant.recordId}</span>
        <span>Grant ${shortHash(grant.grantHash)}</span>
        <span>${grant.revokedAt ? `Revoked ${new Date(grant.revokedAt).toLocaleString()}` : "Active"}</span>
      </div>
      <button class="secondary verifyGrantButton" type="button" data-grant-id="${grant.grantId}">권한 검증</button>
    `;
    accessGrantsEl.append(item);
  }
}

function renderConsentPolicies() {
  consentPoliciesEl.innerHTML = "";

  if (consentPolicies.length === 0) {
    consentPoliciesEl.innerHTML = "<p class=\"empty\">아직 동의 정책이 없습니다.</p>";
    return;
  }

  for (const policy of consentPolicies) {
    const item = document.createElement("article");
    item.className = `policyItem ${policy.status === "active" ? "activePolicy" : ""}`;
    item.innerHTML = `
      <div>
        <h3>${policy.recipient}</h3>
        <p>${policy.purpose} / ${policy.dataScope} / ${policy.status}</p>
      </div>
      <div class="hashes">
        <span>Record ${policy.recordId}</span>
        <span>Policy ${shortHash(policy.policyHash)}</span>
        <span>Expires ${new Date(policy.expiresAt).toLocaleString()}</span>
      </div>
      <button class="secondary dangerOutline revokePolicyListButton" type="button" data-policy-id="${policy.policyId}" ${policy.status === "active" ? "" : "disabled"}>철회</button>
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
    const approved = request.decision === "approved";
    const item = document.createElement("article");
    item.className = `requestItem ${approved ? "approvedRequest" : "deniedRequest"}`;
    item.innerHTML = `
      <div>
        <h3>${approved ? "승인" : "거절"} / ${request.recipient}</h3>
        <p>${request.purpose} / ${request.dataScope} / ${new Date(request.requestedAt).toLocaleString()}</p>
      </div>
      <div class="hashes">
        <span>Record ${request.recordId}</span>
        <span>Policy ${request.policyHash ? shortHash(request.policyHash) : "-"}</span>
        <span>Request ${shortHash(request.requestHash)}</span>
        <span>Reason ${request.reason}</span>
      </div>
    `;
    accessRequestsEl.append(item);
  }
}

function renderAuditEvents() {
  auditEventsEl.innerHTML = "";

  if (auditLog.length === 0) {
    auditEventsEl.innerHTML = "<p class=\"empty\">아직 감사 로그가 없습니다.</p>";
    return;
  }

  for (const entry of [...auditLog].reverse()) {
    const item = document.createElement("article");
    item.className = "auditEvent";
    item.innerHTML = `
      <div>
        <h3>${entry.action}</h3>
        <p>${new Date(entry.timestamp).toLocaleString()} / ${entry.actor}</p>
      </div>
      <div class="hashes">
        <span>Record ${entry.recordId}</span>
        <span>Prev ${shortHash(entry.previousHash)}</span>
        <span>Event ${shortHash(entry.eventHash)}</span>
      </div>
    `;
    auditEventsEl.append(item);
  }
}

function validityLabel(value) {
  if (value === null || value === undefined) {
    return "N/A";
  }
  return value ? "정상" : "실패";
}

function renderTamperSimulation(result, mode) {
  const simulation = mode === "ledger" ? result.ledger : result.auditLog;
  const title = mode === "ledger" ? "원장 블록 조작" : "감사 로그 조작";
  const detected = simulation.afterValid === false;

  tamperSimulationResultEl.innerHTML = `
    <div class="simulationCard ${detected ? "detected" : ""}">
      <div>
        <h3>${title}</h3>
        <p>${simulation.message}</p>
      </div>
      <dl>
        <div><dt>대상</dt><dd>${simulation.targetIndex ?? "-"}</dd></div>
        <div><dt>변경 필드</dt><dd>${simulation.changedField ?? "-"}</dd></div>
        <div><dt>변경 전</dt><dd>${validityLabel(simulation.beforeValid)}</dd></div>
        <div><dt>변경 후</dt><dd>${validityLabel(simulation.afterValid)}</dd></div>
      </dl>
      <div class="hashes">
        <span>Original ${simulation.originalHash ? shortHash(simulation.originalHash) : "-"}</span>
        <span>Simulated ${simulation.simulatedHash ? shortHash(simulation.simulatedHash) : "-"}</span>
      </div>
    </div>
  `;
}

async function runTamperSimulation(mode) {
  tamperSimulationResultEl.innerHTML = "<p class=\"message\">시뮬레이션 실행 중...</p>";
  const result = await getJson("/api/tamper-simulation");
  renderTamperSimulation(result, mode);
}

async function runSecretSharingDemo() {
  const record = selectedRecord();
  if (!record) {
    secretSharingResult.innerHTML = "<p class=\"message dangerText\">기록을 선택하세요.</p>";
    return;
  }

  secretSharingResult.innerHTML = "<p class=\"message\">Secret sharing 실행 중...</p>";
  const actor = encodeURIComponent(ownerInput.value || "admin");
  const demo = await getJson(`/api/secret-sharing-demo/${encodeURIComponent(record.recordId)}?actor=${actor}`);
  secretSharingResult.innerHTML = `
    <div class="secretSharingCard">
      <div>
        <h3>${demo.demoType}</h3>
        <p>${demo.input} / raw EEG used: ${demo.rawEegUsed ? "yes" : "no"}</p>
      </div>
      <div class="shareRows">
        ${demo.metrics.map((metric) => `
          <div class="shareRow">
            <strong>${metric.metric}</strong>
            <span>복원 ${metric.reconstructedValue} / ${metric.verified ? "검증됨" : "검증 실패"}</span>
            <small>${metric.shares.map((share) => `${share.holder}:${share.value}`).join(" | ")}</small>
          </div>
        `).join("")}
      </div>
    </div>
  `;
  await loadRecords();
}

async function createConsentPolicy() {
  consentMessage.textContent = "동의 정책 생성 중...";
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
  consentMessage.textContent = result.valid
    ? `동의 정책 생성 완료: ${shortHash(result.policy.policyHash)}`
    : "동의 정책 검증 실패";
  consentMessage.className = result.valid ? "message okText" : "message dangerText";
  await loadRecords();
}

async function requestAccessEvaluation() {
  consentMessage.textContent = "접근 요청 평가 중...";
  const record = selectedRecord();
  if (!record) {
    consentMessage.textContent = "기록을 선택하세요.";
    consentMessage.className = "message dangerText";
    return;
  }

  const result = await postJson("/api/access-requests", {
    recordId: record.recordId,
    recipient: consentRecipient.value,
    purpose: consentPurpose.value,
    dataScope: consentScope.value
  });
  consentMessage.textContent = result.decision === "approved"
    ? `접근 승인: ${result.reason}`
    : `접근 거절: ${result.reason}`;
  consentMessage.className = result.decision === "approved" ? "message okText" : "message dangerText";
  await loadRecords();
}

async function revokeConsentPolicy(policyId) {
  consentMessage.textContent = "동의 정책 철회 중...";
  const result = await postJson("/api/consent-policies/revoke", {
    policyId,
    actor: ownerInput.value || "demo-user"
  });
  consentMessage.textContent = result.valid
    ? `동의 정책 철회 완료: ${shortHash(result.policy.policyHash)}`
    : "동의 정책 철회 검증 실패";
  consentMessage.className = result.valid ? "message okText" : "message dangerText";
  await loadRecords();
}

async function revokeSelectedConsentPolicy() {
  const policy = latestActiveConsentPolicy();
  if (!policy) {
    consentMessage.textContent = "철회할 활성 동의 정책이 없습니다.";
    consentMessage.className = "message dangerText";
    return;
  }

  await revokeConsentPolicy(policy.policyId);
}

async function grantAccess() {
  accessMessage.textContent = "접근권 발급 중...";
  const record = selectedRecord();
  if (!record) {
    accessMessage.textContent = "기록을 선택하세요.";
    accessMessage.className = "message dangerText";
    return;
  }

  const result = await postJson("/api/access-grants", {
    recordId: record.recordId,
    actor: ownerInput.value,
    grantee: "research-admin"
  });
  accessMessage.textContent = result.allowed
    ? `접근권 발급 완료: ${shortHash(result.grant.grantHash)}`
    : "접근권 발급 실패";
  accessMessage.className = result.allowed ? "message okText" : "message dangerText";
  await loadRecords();
}

async function revokeAccess() {
  accessMessage.textContent = "접근권 철회 중...";
  const grant = selectedGrant();
  if (!grant) {
    accessMessage.textContent = "철회할 활성 접근권이 없습니다.";
    accessMessage.className = "message dangerText";
    return;
  }

  const result = await postJson("/api/access-grants/revoke", {
    grantId: grant.grantId,
    actor: ownerInput.value
  });
  accessMessage.textContent = result.allowed
    ? "접근권 철회 실패"
    : `접근권 철회 완료: ${shortHash(result.grant.grantHash)}`;
  accessMessage.className = result.allowed ? "message dangerText" : "message okText";
  await loadRecords();
}

async function verifyAccessGrant(grantId) {
  const result = await postJson("/api/access-grants/verify", {
    grantId,
    actor: "admin"
  });
  const label = result.allowed ? "허용" : "차단";
  accessMessage.textContent = `접근권 검증: ${label} / ${shortHash(result.grant.grantHash)}`;
  accessMessage.className = result.allowed ? "message okText" : "message dangerText";
  await loadRecords();
}

function renderUploadEvidence(result) {
  if (!uploadEvidence) {
    return;
  }

  if (!result || !result.record) {
    uploadEvidence.innerHTML = "";
    return;
  }

  const record = result.record;
  const storage = record.storage || {};
  const receipt = result.transactionReceipt || latestReceiptForRecordUi(record.recordId, "EEGRecordRegistered");
  const txDetail = receipt
    ? `Tx ${txLink(receipt)} / Block #${receipt.blockNumber || "-"}`
    : "receipt 없음";

  uploadEvidence.innerHTML = `
    <div class="uploadEvidenceHeader">
      <strong>업로드 증거</strong>
      <span>${escapeHtml(statusLabel(receipt || { status: "기록됨" }))}</span>
    </div>
    <div class="uploadEvidenceRows">
      <span>Record ${escapeHtml(record.recordId)}</span>
      <span>Object ${escapeHtml(storage.objectKey || record.objectKey || "-")}</span>
      <span>${txDetail}</span>
    </div>
  `;
}

async function loadRecords() {
  const response = await fetch("/api/records");
  const data = await response.json();
  records = data.records || [];
  ledger = data.ledger || [];
  auditLog = data.auditLog || [];
  accessGrants = data.accessGrants || [];
  consentPolicies = data.consentPolicies || [];
  accessRequests = data.accessRequests || [];
  blockchainReceipts = data.blockchainReceipts || [];
  runtime = data.runtime || {};
  renderLedgerStatus(data.ledgerValid);
  renderAuditStatus(data.auditLogValid);
  renderRuntimeCards();
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
}

async function uploadContent({ fileName, owner, content }) {
  const result = await postJson("/api/records", { fileName, owner, content });
  renderLedgerStatus(result.ledgerValid);
  uploadMessage.textContent = `기록 완료: ${shortHash(result.record.rawHash)}`;
  uploadMessage.className = "message okText";
  await loadRecords();
  recordSelect.value = result.record.recordId;
  renderRecordDetail();
  renderUploadEvidence(result);
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  uploadMessage.textContent = "업로드 중...";
  uploadMessage.className = "message";
  renderUploadEvidence(null);

  try {
    const file = fileInput.files[0];
    await uploadContent({
      fileName: file.name,
      owner: ownerInput.value,
      content: await readFileText(file)
    });
    uploadForm.reset();
    ownerInput.value = "demo-user";
  } catch (error) {
    uploadMessage.textContent = error.message;
    uploadMessage.className = "message dangerText";
    renderUploadEvidence(null);
  }
});

sampleButton.addEventListener("click", async () => {
  uploadMessage.textContent = "샘플 업로드 중...";
  uploadMessage.className = "message";
  renderUploadEvidence(null);

  try {
    const response = await fetch("/sample/eeg-sample.csv");
    await uploadContent({
      fileName: "eeg-sample.csv",
      owner: ownerInput.value,
      content: await response.text()
    });
  } catch (error) {
    uploadMessage.textContent = error.message;
    uploadMessage.className = "message dangerText";
    renderUploadEvidence(null);
  }
});

verifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  verifyMessage.textContent = "검증 중...";

  try {
    const content = await readFileText(verifyFileInput.files[0]);
    const record = selectedRecord();
    if (!record) {
      throw new Error("검증 기준 기록을 선택하세요.");
    }

    const result = await postJson("/api/verify", {
      content,
      expectedRawHash: record.rawHash
    });
    verifyMessage.textContent = result.matches
      ? `검증 성공: ${shortHash(result.computedHash)}`
      : `검증 실패: ${shortHash(result.computedHash)}`;
    verifyMessage.className = result.matches ? "message okText" : "message dangerText";
  } catch (error) {
    verifyMessage.textContent = error.message;
    verifyMessage.className = "message dangerText";
  }
});

async function runStoredVerification(tampered) {
  verifyMessage.textContent = "검증 중...";

  try {
    const record = selectedRecord();
    if (!record) {
      throw new Error("검증 기준 기록을 선택하세요.");
    }

    const result = await postJson("/api/demo-verify", {
      recordId: record.recordId,
      tampered,
      actor: ownerInput.value
    });
    const success = tampered ? !result.matches : result.matches;
    verifyMessage.textContent = tampered
      ? success
        ? `변조 감지 성공: ${shortHash(result.computedHash)}`
        : "변조를 감지하지 못했습니다."
      : success
        ? `원본 검증 성공: ${shortHash(result.computedHash)}`
        : `원본 검증 실패: ${shortHash(result.computedHash)}`;
    verifyMessage.className = success ? "message okText" : "message dangerText";
  } catch (error) {
    verifyMessage.textContent = error.message;
    verifyMessage.className = "message dangerText";
  }
}

verifyStoredButton.addEventListener("click", () => runStoredVerification(false));
verifyTamperedButton.addEventListener("click", () => runStoredVerification(true));
recordSelect.addEventListener("change", renderRecordDetail);
grantAccessButton.addEventListener("click", grantAccess);
revokeAccessButton.addEventListener("click", revokeAccess);
createPolicyButton.addEventListener("click", createConsentPolicy);
requestAccessButton.addEventListener("click", requestAccessEvaluation);
revokePolicyButton.addEventListener("click", revokeSelectedConsentPolicy);
consentRecipient.addEventListener("input", syncConsentButtons);
consentPurpose.addEventListener("change", syncConsentButtons);
consentScope.addEventListener("change", syncConsentButtons);
downloadProofButton.addEventListener("click", async () => {
  const record = selectedRecord();
  if (!record) {
    return;
  }

  const actor = encodeURIComponent(ownerInput.value || "demo-user");
  const proof = await getJson(`/api/proofs/${encodeURIComponent(record.recordId)}?actor=${actor}`);
  downloadJson(`neuroproof-${record.recordId}.json`, proof);
  accessMessage.textContent = "프라이버시 영수증 다운로드 완료";
  accessMessage.className = "message okText";
  await loadRecords();
});
userTab.addEventListener("click", () => switchView("user"));
adminTab.addEventListener("click", () => switchView("admin"));
for (const button of adminFilterButtons) {
  button.addEventListener("click", () => {
    adminFilter = button.dataset.adminFilter;
    applyAdminFilter();
  });
}
simulateLedgerButton.addEventListener("click", () => runTamperSimulation("ledger"));
simulateAuditButton.addEventListener("click", () => runTamperSimulation("audit"));
secretSharingButton.addEventListener("click", runSecretSharingDemo);
accessGrantsEl.addEventListener("click", (event) => {
  if (event.target.matches(".verifyGrantButton")) {
    verifyAccessGrant(event.target.dataset.grantId);
  }
});
consentPoliciesEl.addEventListener("click", (event) => {
  if (event.target.matches(".revokePolicyListButton")) {
    revokeConsentPolicy(event.target.dataset.policyId);
  }
});
refreshButton.addEventListener("click", loadRecords);
applyAdminFilter();
loadRecords();
