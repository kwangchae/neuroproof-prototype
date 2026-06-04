# NeuroProof Prototype

EEG CSV 파일을 클라우드형 저장소에 보관하고, 원본 해시와 분석 결과 해시를 블록체인형 원장에 기록하는 간단한 프로토타입입니다.

## 실행

```powershell
npm test
npm start
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 시연 흐름

1. `샘플로 바로 시연`을 누릅니다.
2. 서버가 `data/cloud-objects`에 EEG CSV를 저장합니다.
3. 서버가 theta, alpha, beta, Fp1, Fp2 열의 통계를 계산합니다.
4. 원본 해시와 분석 결과 해시를 `data/ledger.json`에 블록 형태로 기록합니다.
5. `원본 재검증`을 누르면 저장된 EEG 원본의 해시가 원장 기록과 일치하는지 확인합니다.
6. `변조 예시`를 누르면 샘플 값을 0.01만 바꾼 뒤 해시 불일치를 감지합니다.
7. `증명서 다운로드`를 누르면 선택 기록의 원본 해시, 분석 해시, 블록 해시를 담은 JSON 증명서를 받습니다.
8. `Admin` 화면에서 전체 기록, 원장, 감사 로그를 확인합니다.
9. `변조 시뮬레이션`에서 원장 또는 감사 로그 사본을 조작했을 때 검증 실패가 나는지 확인합니다.
10. User 화면에서 접근권을 발급/철회하고 Admin 화면에서 접근권 상태를 검증합니다.
11. User 화면의 `목적 제한 동의 정책`에서 연구 목적과 데이터 범위를 지정해 정책을 만들고 접근 요청을 평가합니다.
12. Admin 화면의 `프라이버시 보존 분석 데모`에서 원본 EEG 없이 파생 요약값만 share로 나눠 복원하는 흐름을 확인합니다.

## 역할 분리

- 클라우드 역할: `data/cloud-objects`가 S3 같은 객체 저장소를 모의합니다.
- 블록체인 역할: `data/ledger.json`이 이전 블록 해시를 연결한 변경 감지 원장을 제공합니다.
- 스마트컨트랙트 이벤트 역할: `data/blockchain-receipts.json`이 local mock chain receipt를 oldest-first append-only로 저장합니다. API와 UI는 newest-first로 보여줍니다.
- 발표 시연 역할: 화면의 블록 목록에서 `Prev`와 `Block` 해시 연결을 보여줄 수 있습니다.
- 증명서 역할: `/api/proofs/{recordId}`가 검증용 JSON 증명서를 생성합니다.
- 감사 로그 역할: `data/audit-log.json`이 업로드, 검증, 증명서 발급 이벤트를 해시 체인으로 기록합니다.
- 접근 권한 역할: `data/access-grants.json`이 기록별 연구자 접근 허용/철회 상태를 저장합니다.
- 동의 정책 역할: `data/consent-policies.json`이 목적, 수신자, 데이터 범위를 해시로 고정합니다.
- 접근 요청 역할: `data/access-requests.json`이 요청 목적과 정책의 일치 여부를 승인/거절 기록으로 남깁니다.
- 프라이버시 위험 라벨 역할: raw EEG 식별 가능성과 집중/휴식 상태 추론 가능성을 선택 기록에 표시합니다.
- 프라이버시 보존 분석 데모 역할: `/api/secret-sharing-demo/{recordId}`가 원본 EEG 대신 파생 요약값만 사용한 share 복원 과정을 보여줍니다.
- 프라이버시 영수증 역할: 증명서 JSON은 원본 EEG가 오프체인에 있고, 온체인에는 해시와 이벤트만 남는다는 점을 명시합니다.
- 변조 시뮬레이션 역할: `/api/tamper-simulation`이 실제 데이터를 변경하지 않고 사본 조작 결과를 보여줍니다.
- 실제 서비스 전환: `STORAGE_PROVIDER=supabase`, `CHAIN_PROVIDER=sepolia`로 바꾸면 Supabase Storage와 Sepolia transaction receipt를 사용할 수 있습니다.

원본 EEG 데이터는 블록체인에 직접 올리지 않고 해시만 기록합니다. 이 방식이 비용과 개인정보 리스크를 줄입니다.

## Local Mock Chain 설계

NeuroProof currently uses a local mock blockchain layer. Sensitive EEG files remain off-chain. The mock chain stores tamper-evident hashes, consent/access/proof events, and smart-contract-compatible transaction receipts. This avoids wallet, RPC, gas, and testnet failure during demos while keeping the data shape close to a future `EEGRegistry.sol` deployment.

저장되는 receipt는 `txHash`, `blockNumber`, `blockHash`, `contractAddress`, `eventName`, `eventSignature`, `gasUsed`, `previousReceiptHash`, `receiptHash`를 포함합니다. `previousReceiptHash`가 receipt들을 연결하므로 중간 삭제, 순서 변경, 필드 변조를 검증할 수 있습니다.

Sepolia 배포로 전환할 때는 `CHAIN_PROVIDER=sepolia`를 켜면 `appendBlockchainReceipt()`가 다음 흐름을 수행합니다.

1. `EEGRegistry.registerRecord(recordId, recordHash, metadataHash, ledgerBlockHash)` 같은 contract method 호출
2. `tx.wait()`
3. receipt에서 event log 파싱
4. 실제 `txHash`, `blockNumber`, `contractAddress`, `gasUsed`, `status`, `args` 저장

## 실제 Supabase/Sepolia 사용

먼저 dependency를 설치하고 Solidity contract를 컴파일합니다.

```powershell
npm install
npm run compile:contract
```

`.env.example`을 참고해 `.env`를 만듭니다. `.env`는 git에 올리지 않습니다.

```env
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://xqwudanhaqzmhylrpjyc.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_BUCKET=eeg-records

CHAIN_PROVIDER=sepolia
SEPOLIA_RPC_URL=
SEPOLIA_PRIVATE_KEY=
EEG_REGISTRY_ADDRESS=
```

Sepolia에 contract를 배포하려면 `SEPOLIA_RPC_URL`과 `SEPOLIA_PRIVATE_KEY`를 먼저 채운 뒤 실행합니다.

```powershell
npm run deploy:sepolia
```

배포가 끝나면 출력된 주소를 `EEG_REGISTRY_ADDRESS`에 넣고 `npm start`를 다시 실행합니다. Supabase bucket은 private bucket을 권장하고, 서버에서는 service role key로 업로드/다운로드합니다.

현재 연결한 Supabase 프로젝트는 `BlockchainPBL`이고 project ref는 `xqwudanhaqzmhylrpjyc`입니다. Storage에는 `eeg-records` private bucket을 만들었고, 업로드 제한은 `text/csv`, `text/plain`, 최대 10MB로 설정했습니다. Supabase Dashboard의 API Keys에서 server-only secret 또는 legacy service role key를 복사해 `.env`의 `SUPABASE_SERVICE_ROLE_KEY`에 넣은 뒤 `STORAGE_PROVIDER=supabase`로 바꾸면 새 EEG 업로드가 Supabase Storage에 저장됩니다.

서비스 키는 브라우저 코드, README, 발표 자료에 넣지 않습니다. 이 프로토타입은 서버의 `lib/cloud-storage.js`에서만 Supabase client를 만들고, 프론트엔드는 `/api/records` 같은 서버 API만 호출합니다.

## Render 배포

이 repo에는 Render Blueprint용 `render.yaml`이 포함되어 있습니다. Render Dashboard에서 `New` -> `Blueprint`를 선택하고 GitHub repo `kwangchae/neuroproof-prototype`를 연결하면 Web Service가 생성됩니다.

Blueprint가 자동으로 채우는 값:

- `STORAGE_PROVIDER=supabase`
- `SUPABASE_URL=https://xqwudanhaqzmhylrpjyc.supabase.co`
- `SUPABASE_BUCKET=eeg-records`
- `CHAIN_PROVIDER=sepolia`
- `EEG_REGISTRY_ADDRESS=0xfa755F2783Df9939E74149c51f4E6121C8d55c13`
- `METADATA_PROVIDER=supabase`
- `SUPABASE_APP_STATE_TABLE=app_state`

Render Dashboard에서 직접 입력해야 하는 secret 값:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SEPOLIA_RPC_URL`
- `SEPOLIA_PRIVATE_KEY`

Render 배포본은 `METADATA_PROVIDER=supabase`를 사용해 `data/*.json`에 해당하던 records, ledger, audit log, receipt 상태를 Supabase Postgres의 `app_state` 테이블에 저장합니다. 이 테이블은 RLS가 켜져 있고 서버의 service role key로만 접근합니다. 로컬 개발에서는 기본값인 `METADATA_PROVIDER=local`을 유지하면 기존처럼 `data/*.json`을 사용합니다.

적용한 Supabase schema는 `docs/supabase-app-state.sql`에 기록했습니다.

무료 Render Web Service는 재시작 또는 비활성 spin-down 이후 로컬 파일 변경이 사라질 수 있습니다. 이 배포 구성에서는 EEG CSV는 Supabase Storage, blockchain event는 Sepolia, UI 메타데이터는 Supabase Postgres에 저장되므로 Render 인스턴스 재시작 이후에도 시연 상태가 유지됩니다.

## 논문 문제와 프로토타입 대응

- 모호한 동의: 목적 제한 동의 정책이 `recipient`, `purpose`, `dataScope`를 해시로 고정합니다.
- 철회 가능성 부족: 정책과 접근권을 철회하고 감사 로그에 이벤트를 남깁니다.
- 민감한 목적/수신자 문제: `marketing`, `employer` 같은 목적은 기본 차단 정책으로 평가됩니다.
- 파생 EEG 추론 위험: 집중도, 휴식 상태 같은 파생 지표에 위험 라벨을 표시합니다.
- 원본 EEG 노출 문제: 원본은 로컬 클라우드 객체 저장소에만 두고 원장에는 해시만 기록합니다.
- 프라이버시 보존 분석 필요: secret sharing 데모가 원본 샘플 없이 파생 요약값만 복원합니다.
