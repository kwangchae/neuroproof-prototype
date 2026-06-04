# Mock Blockchain Depth Design

## Goal

NeuroProof currently proves EEG integrity with a local hash-chain ledger. The next enhancement should make the blockchain layer look and behave closer to a smart-contract-backed system without requiring a wallet, RPC key, test ETH, or live testnet deployment.

The feature will add mock transaction receipts and smart-contract-like event logs for major actions. This keeps the demo stable for presentation while showing a clear migration path to a real `EEGRegistry.sol` deployment.

## Scope

Implement a local mock blockchain layer that records:

- schema version
- chain id and local mock network name
- transaction hash
- block number
- block hash
- transaction index and log index
- contract address
- contract name
- event name
- event signature
- gas used
- transaction status
- linked record, policy, access request, proof, or audit event
- previous receipt hash
- event arguments aligned with `contracts/EEGRegistry.sol`

Display those receipts in Admin and include the relevant receipt in proof certificate JSON.

This scope does not deploy to Sepolia, connect MetaMask, add Hardhat, or require external blockchain services.

## User Value

For presentation, the prototype can now say:

> Sensitive EEG data stays off-chain. The chain stores verifiable hashes, permissions, and event receipts. The current app uses a local mock chain, but the event and receipt shape is designed to map to a smart contract.

This improves the technical depth of the blockchain part without creating live-network risk.

## Architecture

### New Module

Create `lib/blockchain-receipts.js`.

Responsibilities:

- build deterministic-looking mock transaction receipts
- create event argument payloads for known event names
- validate receipt hashes
- validate receipt chain continuity
- derive Ethereum-looking mock addresses and hashes
- canonicalize JSON before hashing
- expose constants for mock contract metadata

The module should not read or write files. It should be testable as pure logic.

Required exports:

- `MOCK_CHAIN`
- `MOCK_CONTRACT`
- `EVENT_NAMES`
- `EVENT_SCHEMAS`
- `GAS_USED_BY_EVENT`
- `buildEventArgs(eventName, input)`
- `createMockReceipt(input, context)`
- `hashReceipt(receipt)`
- `validateReceiptHash(receipt)`
- `validateReceiptChain(receipts)`
- `deriveMockAddress(seed)`
- `deriveTxHash(receiptDraft)`
- `canonicalize(value)`

`receiptHash` must be calculated from canonical JSON with `receiptHash` omitted. This avoids unstable hashes caused by JavaScript object key order.

### New Data Store

Create `data/blockchain-receipts.json`.

File storage must be oldest-first and append-only. New receipts are appended to the end of the JSON array. API responses and UI rendering should return newest-first by reversing or sorting the stored list at read time.

This separation avoids a contradiction: inserting at the front of the file would look newest-first, but it would not be append-only.

Each receipt will contain enough fields for UI display, chain validation, and proof certificate linkage:

```json
{
  "schemaVersion": 1,
  "chainId": 31337,
  "networkName": "neuroproof-local-mock",
  "txHash": "0x...",
  "blockNumber": 12,
  "blockHash": "0x...",
  "transactionIndex": 0,
  "logIndex": 0,
  "contractAddress": "0x...",
  "contractName": "EEGRegistry",
  "eventName": "EEGRecordRegistered",
  "eventSignature": "EEGRecordRegistered(bytes32,bytes32,bytes32,address,uint256)",
  "status": "success",
  "gasUsed": 74231,
  "recordId": "mp...",
  "policyId": null,
  "accessRequestId": null,
  "proofId": null,
  "linkedAuditEventHash": "abc...",
  "actor": "0x...",
  "args": {},
  "previousReceiptHash": "sha256:...",
  "createdAt": "2026-06-04T00:00:00.000Z",
  "receiptHash": "..."
}
```

Ethereum-looking fields must match:

- `contractAddress`: `/^0x[a-fA-F0-9]{40}$/`
- `txHash`: `/^0x[a-fA-F0-9]{64}$/`
- `blockHash`: `/^0x[a-fA-F0-9]{64}$/`

The first receipt uses `"0".repeat(64)` or an equivalent `sha256:` genesis marker for `previousReceiptHash`. Each later receipt uses the previous stored receipt's `receiptHash`.

### Server Integration

Add helper functions in `server.js`:

- `appendBlockchainReceipt({ eventName, recordId, actor, args, linkedAuditEventHash })`
- `readBlockchainReceipts()`
- `latestReceiptForRecord(recordId, eventName)`
- `validatedBlockchainReceipts(filters)`

Call `appendBlockchainReceipt` after these actions:

- `createRecord` -> `EEGRecordRegistered`
- `createConsentPolicy` -> `ConsentPolicyCreated`
- `revokeConsentPolicy` -> `ConsentPolicyRevoked`
- `createAccessRequest` -> `AccessRequestEvaluated`
- `readProofCertificate` -> `ProofCertificateIssued`

The receipt should link to the audit event hash when an audit event is generated for the same action. Receipt creation should be validated before domain data is persisted where possible, so API actions do not half-claim a blockchain event that cannot be represented.

JSON writes should stay simple, but write helpers should prefer temp-file-plus-rename atomic writes for receipt storage if that can be added without broad refactoring.

### API Changes

Extend `GET /api/records` response with:

- `blockchainReceipts`

Add:

- `GET /api/blockchain-receipts`

The separate endpoint is useful for future external verification, while `/api/records` keeps the current UI simple.

Support filters:

- `GET /api/blockchain-receipts`
- `GET /api/blockchain-receipts?recordId=...`
- `GET /api/blockchain-receipts?eventName=...`
- `GET /api/blockchain-receipts?recordId=...&eventName=...`
- `GET /api/blockchain-receipts?limit=20`

API responses should include computed validation status such as `isValid`. Do not store `isValid` in the JSON file; it is derived from current file contents.

### Proof Certificate Changes

When `readProofCertificate` issues a proof, create a `ProofCertificateIssued` receipt and include that same receipt in the proof JSON:

```json
{
  "transactionReceipt": {
    "txHash": "0x...",
    "blockNumber": 12,
    "contractAddress": "0x...",
    "eventName": "ProofCertificateIssued",
    "receiptHash": "..."
  }
}
```

If receipt creation is disabled or unavailable for older imported records, the proof should still generate and use `null` for `transactionReceipt`.

Avoid circular hashes:

1. Build `certificateCore` without `transactionReceipt`.
2. Compute `certificateCoreHash = hash(certificateCore)`.
3. Create `ProofCertificateIssued.args.certificateCoreHash`.
4. Return the full proof with `transactionReceipt` attached.

External verification can recalculate the proof core hash after removing `transactionReceipt` and compare it with the receipt args.

Keep the existing `GET /api/proofs/:recordId` route for this prototype. Receipt generation must be idempotent for the same `certificateCoreHash`: reuse an existing `ProofCertificateIssued` receipt instead of creating a duplicate on every download. A future production API can replace this with `POST /api/records/:recordId/proof-certificate`, but that route change is out of scope for this iteration.

### Admin UI

Add an Admin panel named `스마트컨트랙트 이벤트`.

Show:

- event name
- validation status
- tx hash
- block number
- gas used
- linked record id
- linked audit hash
- receipt hash
- event args summary

This panel should appear near the current blockchain ledger panel, before `블록체인형 원장`, because it explains what the local ledger would look like on a real chain.

Panel subtitle:

```text
Local Mock Chain · EEGRegistry-compatible receipts
```

Long hashes should be truncated in the table and exposed with copy buttons or compact full-value text on demand. The table must not create horizontal overflow.

### README

Add a short section:

- current system: local mock chain
- live-chain migration path
- event names mapped to smart contract semantics
- what would change for Sepolia deployment

## Event Names

Use these event names:

- `EEGRecordRegistered`
- `ConsentPolicyCreated`
- `ConsentPolicyRevoked`
- `AccessRequestEvaluated`
- `ProofCertificateIssued`

These names are intentionally explicit and presentation-friendly. If `EEGRegistry.sol` has fewer events today, the Solidity file can be extended later to match this schema.

Event args are fixed as:

| Event | Args |
| --- | --- |
| `EEGRecordRegistered` | `recordId`, `recordHash`, `metadataHash`, `ledgerBlockHash`, `registeredBy`, `registeredAt` |
| `ConsentPolicyCreated` | `policyId`, `recordId`, `policyHash`, `granteeHash`, `allowedActions`, `expiresAt`, `createdBy` |
| `ConsentPolicyRevoked` | `policyId`, `recordId`, `revokedBy`, `revokedAt`, `reasonHash` |
| `AccessRequestEvaluated` | `requestId`, `recordId`, `policyId`, `requesterHash`, `decision`, `evaluatedBy`, `evaluatedAt` |
| `ProofCertificateIssued` | `proofId`, `recordId`, `certificateCoreHash`, `issuedBy`, `issuedAt` |

Privacy rule: raw EEG, full names, emails, free-text health context, and detailed request reasons must never be stored in `args` or Admin summaries. Use hashes such as `granteeHash`, `requesterHash`, and `reasonHash` when identity-like or reason-like values are needed.

## Data Flow

1. User uploads EEG.
2. Server stores raw EEG off-chain and appends ledger block.
3. Server appends audit event.
4. Server creates mock blockchain receipt linked to record and audit event.
5. Admin UI reads receipts from `/api/records`.
6. Proof download creates and includes a `ProofCertificateIssued` transaction receipt.

Consent and access request flows follow the same pattern: domain action, audit event, mock transaction receipt.

## Error Handling

- Receipt creation should not silently hide invalid event names.
- If receipt creation fails during a user action, the API should fail the action rather than claiming a blockchain event exists.
- Older records without receipts should remain readable.
- Receipt validation should detect tampering by recalculating `receiptHash`.
- Receipt chain validation should detect deletion, insertion, and order changes through `previousReceiptHash`.
- Invalid event args should fail before receipt persistence.

## Testing

Add tests for:

- receipt construction has `0x` transaction hash and contract address
- receipt hash validation rejects tampering
- receipt chain validation rejects deleted or reordered receipts
- server proof certificate supports `transactionReceipt`
- mock event names are stable
- invalid event names throw
- file storage remains oldest-first while API/UI reads newest-first
- proof `transactionReceipt.receiptHash` matches a stored receipt
- older imported records can still generate proof with `transactionReceipt: null` when no receipt is available
- existing tests still pass

Browser/API smoke checks:

- upload sample and confirm a receipt appears
- create consent policy and confirm `ConsentPolicyCreated`
- evaluate access request and confirm `AccessRequestEvaluated`
- download proof and confirm `transactionReceipt`
- Admin panel renders without horizontal overflow

## Non-Goals

- No real testnet deployment
- No wallet integration
- No private key handling
- No RPC configuration
- No Solidity compilation requirement
- No database migration beyond JSON files
- No raw EEG, direct personal identifiers, or detailed health context in receipt args

## README Migration Text

README should describe the mock chain accurately:

```text
NeuroProof currently uses a local mock blockchain layer. Sensitive EEG files remain off-chain. The mock chain stores tamper-evident hashes, consent/access/proof events, and smart-contract-compatible transaction receipts. This avoids wallet, RPC, gas, and testnet failure during demos while keeping the data shape close to a future EEGRegistry.sol deployment.
```

Sepolia migration path:

```text
For Sepolia deployment, appendBlockchainReceipt() can be replaced with:
1. contract method call, e.g. EEGRegistry.registerRecord(...)
2. tx.wait()
3. parse event logs from the receipt
4. store the real txHash, blockNumber, contractAddress, gasUsed, status, and args
```

## Approval Criteria

The enhancement is complete when:

- `npm test` passes
- `/api/records` includes `blockchainReceipts`
- Admin shows `스마트컨트랙트 이벤트`
- receipts include `previousReceiptHash`, `blockHash`, `chainId`, and `eventSignature`
- receipt chain validation detects tampering, deletion, and reordering
- proof JSON includes `transactionReceipt`
- proof issuance avoids certificate/receipt hash circularity through `certificateCoreHash`
- README explains mock-chain-to-testnet migration
- browser verification shows no console errors or horizontal overflow
