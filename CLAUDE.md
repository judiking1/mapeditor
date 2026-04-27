# CitySim Web — Cities: Skylines 2 스타일 웹 시티 빌더

브라우저에서 동작하는 도시 건설 시뮬레이션. 도로 에디팅, 건물 건설, 차량 시뮬레이션, 저장/불러오기를 핵심 기능으로 한다.

## 핵심 원칙

1. **퍼포먼스 우선**: 수천~수만 개의 차량/건물을 60fps로 굴려야 한다. SoA(Structure of Arrays) + TypedArray + Web Worker가 기본. 성능 회귀를 일으키는 코드는 거절한다.
2. **권위 있는 시뮬레이션은 워커에서**: 메인 스레드는 입력/렌더링만. 시뮬레이션 틱은 Web Worker가 돌리고 SharedArrayBuffer 또는 transferable로 결과만 전달.
3. **렌더링은 WebGPU 기본, WebGL2 폴백**: WebGPU 미지원 브라우저에서도 최소한 보이기는 해야 한다.
4. **데이터는 평탄화된 TypedArray**: 차량/건물/도로 노드는 클래스 인스턴스 배열이 아니라 Float32Array/Int32Array에 packed. ID는 인덱스.
5. **도로는 그래프**: 노드(intersection) + 세그먼트(edge)로 모델링. 곡선은 베지어. 차량은 세그먼트의 차선(lane) 단위로 이동.

## 기술 스택

- **런타임**: TypeScript (strict), Vite + ESM
- **렌더링**: WebGPU (1차) / WebGL2 (폴백). three.js는 사용하지 않는다 — 직접 제어.
- **시뮬레이션 워커**: TypeScript → 일반 Web Worker. 핵심 hot loop는 필요시 AssemblyScript로 WASM 빌드 가능.
- **상태 동기화**: SharedArrayBuffer + Atomics (cross-origin isolation 헤더 필요). 폴백은 transferable ArrayBuffer.
- **저장**: IndexedDB (큰 맵 데이터) + LocalStorage (작은 설정). Export/Import는 단일 `.citysim` 바이너리 파일 (`.json.gz` 폴백).
- **빌드/테스트**: Vite, Vitest, Playwright (E2E는 나중).

## 프로젝트 구조

```
src/
  app/              메인 스레드 진입점, 부트스트랩
  ui/               React 또는 Lit (TBD), 툴바/패널만
  render/           WebGPU/WebGL2 렌더러, 카메라, 카메라 컨트롤
    pipelines/      각 파이프라인 (terrain, road, building, vehicle instanced)
    shaders/        WGSL/GLSL
  sim/              시뮬레이션 코어 (워커에서 import)
    world/          지형, 그리드/타일
    road/           도로 그래프, 차선, 베지어
    traffic/        차량 AI, 경로탐색 (A*/CH), 신호
    economy/        인구, 자원, 수요 (스텁부터)
    agent/          시민/차량 에이전트 SoA
  worker/           Web Worker 엔트리, 메시지 프로토콜
  io/               저장/불러오기, 직렬화 포맷
  math/             vec/mat, 베지어, 충돌
  tools/            에디터 툴 (도로 그리기, 건물 배치, 지형 페인트)
  types/            공유 타입
```

## 코드 컨벤션

- **TypeScript strict + noUncheckedIndexedAccess**. `any` 금지. unknown→narrow.
- **클래스보다 함수와 데이터**. 상태는 모듈 단위 또는 SoA 버퍼로 관리.
- **숫자 타입 명시**: `number`만 쓰지 말고 alias 사용 (`type EntityId = number & { __brand: 'EntityId' }`).
- **빅엔디안 가정 금지**. `DataView`로 명시적 little-endian 직렬화.
- **불변성은 유용한 곳에만**. SoA 버퍼는 in-place mutate가 정상이다 — 성능을 위해.
- **주석은 WHY만**. 왜 이 알고리즘/근사를 골랐는지 짧게. WHAT은 코드가 말한다.
- **emoji는 쓰지 않는다**.

## 시뮬레이션 모델 (요약)

- **틱**: 고정 timestep 30Hz (33.33ms). 렌더는 별개 가변 fps. 보간으로 부드럽게.
- **시간 배속**: 1x/3x/9x — 틱 빈도를 늘리는 게 아니라 sim time scale을 곱한다.
- **차량**: SoA — `posX, posY, posZ, headingY, segId, laneIdx, t (0..1 along seg), speed, dest`. 최대 65535대 시작.
- **도로**: nodes[] (Float32 x,y,z + Int32 type), segments[] (nodeA, nodeB, controlA, controlB, lanesFwd, lanesBwd, type). 인덱스 기반.
- **경로탐색**: 세그먼트 그래프 위 A*. 큰 맵에서는 Contraction Hierarchies 검토 (나중).
- **신호/우선권**: 교차로 노드에 신호 페이즈 + 양보. v1은 단순 4-way 스톱.

## 저장 포맷 (`.citysim`)

매직 `CSIM` (4 bytes) + version u32 + chunk 리스트. 각 chunk: `tag u32 | size u32 | payload`. 청크: `MAP `, `ROAD`, `BLDG`, `VEHC`, `META`. 모두 little-endian. v0은 비압축, v1에서 deflate.

## 성능 예산

- 60fps @ 메인 스레드 frame budget 16.67ms 중 렌더링 ≤ 8ms.
- sim 틱 ≤ 10ms @ 5000 차량 + 2000 건물.
- 빌드 결과 첫 화면까지 < 3s on broadband.

## 개발 규칙 (Claude에게)

- **점진 빌드**: 매 단계 빌드/타입체크가 통과해야 한다. 거대한 무빌드 PR 금지.
- **TODO 남기지 말 것**. 미구현이면 명시적 stub 함수 + 호출부에서 가드.
- **벤치 우선**: 수만 단위 엔티티를 다루는 코드는 작성 직후 간이 벤치 (`vitest bench` 또는 직접 시간 측정)로 회귀 방지.
- **도큐는 코드와 함께**. 새 모듈 추가 시 README가 아니라 모듈 상단의 짧은 헤더 주석으로.
- **PR 단위로 사고하기**: 한 번에 한 가지 케이퍼빌리티. 예: "도로 그래프 자료구조"와 "도로 렌더 파이프라인"은 분리.

## 마일스톤

- **M0 부트스트랩** ✅ 시작점: 빈 캔버스 + WebGPU/WebGL2 컨텍스트 + 워커 핸드셰이크 + 기본 카메라.
- **M1 지형**: 하이트맵 렌더, 카메라 RTS 컨트롤 (pan/zoom/rotate/tilt).
- **M2 도로 v1**: 직선 도로 그리기, 노드 스냅, 곡선(베지어) 1단계.
- **M3 저장/불러오기**: 바이너리 포맷 round-trip + IndexedDB.
- **M4 차량 시뮬**: 도로 위 차량 인스턴스 렌더 + 단순 경로 추종 + 신호 없음.
- **M5 건물 v1**: 존(zone) 페인트 + 지정된 셀에 자동 건물 배치.
- **M6 교통 v2**: 신호, 차선 변경, 정체.
- **M7 경제 스텁**: 인구/수요 → 건물 성장.

각 마일스톤이 끝나면 main에 머지하고 다음으로 넘어간다.
