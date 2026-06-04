// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract EEGRegistry {
    struct EEGRecord {
        address owner;
        bytes32 recordHash;
        bytes32 metadataHash;
        bytes32 ledgerBlockHash;
        uint256 registeredAt;
    }

    struct ConsentPolicy {
        bytes32 recordId;
        bytes32 policyHash;
        bytes32 granteeHash;
        uint256 expiresAt;
        bool revoked;
    }

    mapping(bytes32 => EEGRecord) public records;
    mapping(bytes32 => ConsentPolicy) public consentPolicies;

    event EEGRecordRegistered(
        bytes32 indexed recordId,
        bytes32 recordHash,
        bytes32 metadataHash,
        bytes32 ledgerBlockHash,
        address indexed registeredBy,
        uint256 registeredAt
    );

    event ConsentPolicyCreated(
        bytes32 indexed policyId,
        bytes32 indexed recordId,
        bytes32 policyHash,
        bytes32 granteeHash,
        string[] allowedActions,
        uint256 expiresAt,
        address indexed createdBy
    );

    event ConsentPolicyRevoked(
        bytes32 indexed policyId,
        bytes32 indexed recordId,
        address indexed revokedBy,
        uint256 revokedAt,
        bytes32 reasonHash
    );

    event AccessRequestEvaluated(
        bytes32 indexed requestId,
        bytes32 indexed recordId,
        bytes32 policyId,
        bytes32 requesterHash,
        string decision,
        address indexed evaluatedBy,
        uint256 evaluatedAt
    );

    event ProofCertificateIssued(
        bytes32 indexed proofId,
        bytes32 indexed recordId,
        bytes32 certificateCoreHash,
        address indexed issuedBy,
        uint256 issuedAt
    );

    function registerRecord(
        bytes32 recordId,
        bytes32 recordHash,
        bytes32 metadataHash,
        bytes32 ledgerBlockHash
    ) external {
        require(records[recordId].registeredAt == 0, "record already exists");

        records[recordId] = EEGRecord({
            owner: msg.sender,
            recordHash: recordHash,
            metadataHash: metadataHash,
            ledgerBlockHash: ledgerBlockHash,
            registeredAt: block.timestamp
        });

        emit EEGRecordRegistered(
            recordId,
            recordHash,
            metadataHash,
            ledgerBlockHash,
            msg.sender,
            block.timestamp
        );
    }

    function createConsentPolicy(
        bytes32 policyId,
        bytes32 recordId,
        bytes32 policyHash,
        bytes32 granteeHash,
        string[] calldata allowedActions,
        uint256 expiresAt
    ) external {
        require(consentPolicies[policyId].policyHash == bytes32(0), "policy already exists");

        consentPolicies[policyId] = ConsentPolicy({
            recordId: recordId,
            policyHash: policyHash,
            granteeHash: granteeHash,
            expiresAt: expiresAt,
            revoked: false
        });

        emit ConsentPolicyCreated(
            policyId,
            recordId,
            policyHash,
            granteeHash,
            allowedActions,
            expiresAt,
            msg.sender
        );
    }

    function revokeConsentPolicy(
        bytes32 policyId,
        bytes32 recordId,
        bytes32 reasonHash
    ) external {
        ConsentPolicy storage policy = consentPolicies[policyId];
        require(policy.policyHash != bytes32(0), "policy not found");
        require(policy.recordId == recordId, "record mismatch");
        require(!policy.revoked, "policy already revoked");

        policy.revoked = true;

        emit ConsentPolicyRevoked(
            policyId,
            recordId,
            msg.sender,
            block.timestamp,
            reasonHash
        );
    }

    function evaluateAccessRequest(
        bytes32 requestId,
        bytes32 recordId,
        bytes32 policyId,
        bytes32 requesterHash,
        string calldata decision
    ) external {
        emit AccessRequestEvaluated(
            requestId,
            recordId,
            policyId,
            requesterHash,
            decision,
            msg.sender,
            block.timestamp
        );
    }

    function issueProofCertificate(
        bytes32 proofId,
        bytes32 recordId,
        bytes32 certificateCoreHash
    ) external {
        emit ProofCertificateIssued(
            proofId,
            recordId,
            certificateCoreHash,
            msg.sender,
            block.timestamp
        );
    }

    function verifyRecord(
        bytes32 recordId,
        bytes32 recordHash,
        bytes32 metadataHash
    ) external view returns (bool) {
        EEGRecord memory record = records[recordId];
        return record.recordHash == recordHash && record.metadataHash == metadataHash;
    }
}
