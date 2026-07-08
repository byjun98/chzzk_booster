# 치지직 부스터 (Chzzk Booster) — MV3 확장 설계 문서

> 크롬/엣지(Chromium) Manifest V3 확장. 기능: ① 광고차단 + 팝업 자동닫기, ② 방송 진입 시 360p로 시작하는 화질을 옵션 지정 화질(디폴트 1080p)로 자동 변경.
> 본 문서는 3개 서브에이전트 조사 + 직접 소스 분석을 통합한 최종 설계다. 코드 스니펫은 기존 공개 구현(유저스크립트/확장)에서 **실제 확인된** 것을 근거로 한다.

---

## 0. 핵심 결정 요약 (TL;DR)

| 항목 | 결정 | 근거 |
|---|---|---|
| 플레이어 | 네이버 **PRISM Player** (`pzp-*` 클래스), HLS(m3u8), Grid(P2P) CDN | 확인됨 |
| **화질 변경 주력** | **localStorage `live-player-video-track` 세팅 (방식 A)** | nomomo/CHZZK_Max_Quality 실제 코드 확인 |
| 화질 폴백 | pzp 설정메뉴 DOM 클릭 (방식 B) — A 미적용 시 | 다수 스크립트 확인 |
| 광고차단 | declarativeNetRequest 정적 룰셋 + 광고 SKIP 버튼 자동 클릭 | 확인/추정 병행 |
| 팝업닫기 | DOM 자동 닫기 + localStorage 선점("이미 봤음" 위장) | 실제 코드 확인 |
| SPA 감지 | content script 폴링 + `history.pushState` 후킹 (2중) | 표준 패턴 |
| 저장 | 사용자 설정 `storage.sync`, 상태/캐시 `storage.local` | — |
| 통신 | `storage.onChanged` 기반 (메시지 패싱 최소화) | SW 생명주기 회피 |
| 권한 | `storage`, `declarativeNetRequest`, `scripting` + 한정 host_permissions | 최소화 |

✅ **실측 완료 (2026-07-08)**: 라이브 방송 콘솔에서 아래 핵심값을 확정 (§8 참조). `live-player-video-track` 키 존재/형식, 화질 메뉴 셀렉터, 미드롤 광고 오버레이 클래스 모두 확인. m3u8은 blob+MSE라 URL 화질 토큰이 없어 **방식 C 제외**. 광고 도메인·SKIP 버튼 셀렉터만 실제 광고 재생 시 추가 보정 필요.

> 설계 개선: content script(ISOLATED)에서도 페이지 `localStorage`에 접근 가능함을 확인 → **MAIN world 스크립트 불필요, 단일 content script로 단순화**. 화질은 localStorage 방식이 기본이고 DOM 강제전환은 옵션(호환모드, 기본 OFF)으로 분리해 메뉴 깜빡임 제거.

---

## 1. 확인된 기술 구조 (통합)

### 1.1 플레이어
- 치지직 플레이어 = 네이버 **PRISM(pzp) Player**. 모든 DOM 클래스가 `pzp-` prefix.
- 스트림은 **HLS (`.m3u8`)**, 비디오 엘리먼트 `video.webplayer-internal-video`.
- **Grid(P2P) CDN** 사용 → P2P 미설치/차단 시 기본 화질이 낮게(360~480p) 잡히는 것이 "화질 저하"의 근본 원인. (확장이 존재하는 이유)
- CDN 도메인: `*.navercdn.com`, `*.pstatic.net`, `*.akamaized.net`.

### 1.2 화질을 바꾸는 3가지 메커니즘

**방식 A — localStorage 직접 세팅 (주력 채택)**
```js
// nomomo/CHZZK_Max_Quality 확인 코드
const fixedQuality = {"label":"1080p","width":1920,"height":1080};
localStorage.setItem('live-player-video-track', JSON.stringify(fixedQuality));
// 1초 감시: 값이 바뀌면 되돌림
setInterval(() => {
  if (localStorage.getItem('live-player-video-track') !== JSON.stringify(fixedQuality))
    localStorage.setItem('live-player-video-track', JSON.stringify(fixedQuality));
}, 1000);
```
- 핵심 키: **`live-player-video-track`**, 값 `{"label","width","height"}`. 플레이어가 이 값을 읽어 초기 화질 결정.
- `document_start`에서 선주입, 권한/ DOM 의존 없음. 옵션 화질은 label 프리셋 테이블로 관리.
- ⚠️ 라이브용 키로 추정. VOD는 다른 키일 수 있음 → 실측.

**방식 B — pzp 설정메뉴 DOM 클릭 (폴백)**
- 설정버튼 → 화질 서브메뉴 → 항목 클릭. 셀렉터가 버전마다 다름:
  - 신버전: `.pzp-pc-setting-quality-pane__list-container > li:first-child:not(.pzp-pc-ui-setting-item--checked)` (first-child = 최고화질)
  - 텍스트 매칭형: `li.pzp-ui-setting-quality-item` 중 텍스트 `/1080p|720p/` 매칭 후 `.click()` + Enter dispatch
  - 체크 상태: `--checked` 클래스
- 취약: 클래스 난독화/업데이트에 깨짐(2024-11-12 대규모 변경 사례). → prefix(`[class^="pzp-"]`) + 텍스트 병행 방어.

**방식 C — m3u8 네트워크 리다이렉트 (고급 옵션, 선택)**
- declarativeNetRequest로 매니페스트 URL의 화질 토큰(`480p`)을 `1080p`로 치환 리다이렉트. UI/localStorage 무관하게 실제 스트림 화질 변경.
- URL 토큰 패턴은 실측 필요. 1차 릴리스에는 미포함, 향후 옵션.

### 1.3 광고 / 팝업

- **광고 SKIP 버튼 자동 클릭**: `button[aria-label='광고 SKIP']` 또는 `button.btn_skip` → MutationObserver로 등장 시 `.click()`.
- **애드블록 감지 팝업 닫기** (확인 코드):
  ```js
  if (document.querySelector('[class^="ad_block_title"]'))
    document.querySelector('[class^=popup_cell] > button')?.click();
  ```
  - attribute-prefix 셀렉터로 난독화 클래스 대응.
- **프로모/이벤트 팝업 선점** (확인 코드): 프로모 localStorage 키를 오늘 날짜로 미리 세팅해 "이미 봤음" 위장 → 안 뜸.
- **광고 CDN 도메인**: `glad-vod.pstatic.net`, `tvetamovie.pstatic.net`.
- ⚠️ **재생 차단 리스크**: 광고를 완전 차단하면 dimmed 오버레이/재생 정지 가능 → "차단"보다 "스킵/숨김 + 오버레이·overflow 원복"이 안전.

---

## 2. 아키텍처

### 2.1 파일 구조
```
chzzk-booster/
├─ manifest.json
├─ rules/
│  └─ adblock.json            # declarativeNetRequest 정적 룰셋 (광고 도메인)
├─ src/
│  ├─ content/
│  │  ├─ main-world.js        # world:MAIN — localStorage 화질 선주입, pushState 후킹
│  │  ├─ isolated.js          # world:ISOLATED — storage 읽기, DOM 조작(팝업/스킵), 감시 루프
│  │  └─ selectors.js         # 셀렉터/키/도메인 상수 중앙화 (깨짐 대응 핵심)
│  ├─ background/
│  │  └─ sw.js                # 룰셋 on/off, 카운터 집계, 옵션 브로드캐스트
│  ├─ popup/
│  │  ├─ popup.html / popup.css / popup.js
│  └─ options/
│     └─ options.html / options.css / options.js
└─ assets/ (아이콘 16/32/48/128, 로고 SVG)
```

### 2.2 manifest.json (초안)
```json
{
  "manifest_version": 3,
  "name": "치지직 부스터",
  "version": "1.0.0",
  "default_locale": "ko",
  "permissions": ["storage", "declarativeNetRequest", "scripting"],
  "host_permissions": [
    "*://chzzk.naver.com/*",
    "*://*.pstatic.net/*",
    "*://*.navercdn.com/*"
  ],
  "background": { "service_worker": "src/background/sw.js" },
  "content_scripts": [
    {
      "matches": ["*://chzzk.naver.com/*"],
      "js": ["src/content/main-world.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["*://chzzk.naver.com/*"],
      "js": ["src/content/isolated.js"],
      "run_at": "document_start",
      "world": "ISOLATED"
    }
  ],
  "declarative_net_request": {
    "rule_resources": [
      { "id": "adblock", "enabled": true, "path": "rules/adblock.json" }
    ]
  },
  "action": { "default_popup": "src/popup/popup.html" },
  "options_page": "src/options/options.html",
  "icons": { "16": "assets/icon16.png", "48": "assets/icon48.png", "128": "assets/icon128.png" }
}
```
> world:MAIN과 ISOLATED를 분리하는 이유: 화질 localStorage 선주입/pushState 후킹은 페이지 컨텍스트(MAIN)에서 `document_start`에 해야 유효. `chrome.storage` 등 확장 API는 ISOLATED에서만 접근 가능. 두 스크립트는 `window.postMessage` 또는 `localStorage`로 옵션값 공유.

### 2.3 데이터 흐름
```
옵션/팝업 UI ──storage.sync.set──▶ chrome.storage
                                      │ onChanged
        ┌─────────────────────────────┼──────────────────────┐
        ▼                             ▼                        ▼
   isolated.js                    sw.js                   (MAIN world)
   (DOM/팝업/스킵/                (룰셋 enable/disable,   화질 localStorage
    감시루프, 화질B)              카운터)                 선주입/감시
```

---

## 3. 기능별 구현 전략

### 3.1 화질 자동 변경 (핵심)
1. **주력(A)**: `main-world.js`가 `document_start`에 옵션 화질 프리셋을 `live-player-video-track`에 주입 + 1초 감시 루프로 값 유지.
2. **폴백(B)**: 진입 후 N초 내 실제 화질이 목표와 다르면 `isolated.js`가 pzp 설정메뉴 DOM 클릭 시도(prefix+텍스트 매칭).
3. **재적용**: 버퍼링/광고 후 플레이어 리셋으로 360p 회귀 시 감시 루프가 재적용. **"현재==목표면 스킵"** 가드로 폭주 방지.
4. **폴백 규칙**: 목표 화질이 없는 방송이면 가장 높은 화질 선택. "원본" 라벨 처리.
5. 화질 프리셋 테이블:
   ```js
   const PRESETS = {
     "1080": {label:"1080p", width:1920, height:1080},
     "720":  {label:"720p",  width:1280, height:720},
     "480":  {label:"480p",  width:854,  height:480},
     "360":  {label:"360p",  width:640,  height:360},
   }; // 값은 실측으로 확정
   ```

### 3.2 광고차단
1. `rules/adblock.json`에 광고 CDN/엔드포인트 차단 룰(정적, 수 개 수준 — 30k 한도 무관).
2. `isolated.js`가 광고 SKIP 버튼을 MutationObserver로 감시 후 자동 클릭.
3. **정책**: 재생 차단 방지를 위해 완전 차단이 재생을 막으면 "스킵/숨김"으로 후퇴. on/off 토글 제공.

### 3.3 팝업 자동 닫기
1. 애드블록 감지 팝업: `[class^="ad_block_title"]` 존재 시 `[class^=popup_cell] > button` 클릭.
2. 프로모/이벤트 팝업: 관련 localStorage 키 선점(오늘 날짜).
3. 팝업 닫은 뒤 `body`/컨테이너의 `overflow:hidden`, `pointer-events` 잔여 스타일 원복.
4. 난독화 클래스 대응: prefix(`[class^=]`)/텍스트 매칭, 셀렉터는 `selectors.js` 중앙 관리.

### 3.4 SPA 라우팅 감지
- `main-world.js`에서 `history.pushState`/`replaceState` 몽키패칭 + `popstate` 리스너.
- 보강: `location.href` 1초 폴링.
- `/live/` URL 진입 감지 시 화질 재적용·감시 재attach.

---

## 4. UI/UX (에이전트 3 통합)

- **역할 분담**: 팝업 = 자주 쓰는 3토글/드롭다운(폭 320px, 무스크롤), 옵션 = 화이트리스트·지연시간 등 정밀 설정 + "더 많은 설정 ›" 링크.
- **치지직 그린 다크 테마**:
  - `--chz-green #00FFA3` (강조/토글/포커스만 점단위 사용), 배경 `#0A0A0C`, 카드 `#141417`, 텍스트 `#F5F5F7`.
  - 그린 위 글자는 검정으로 대비 확보(형광 그린 눈부심 완화).
- **컴포넌트**: 토글 44×24px(켜짐 그린+glow), 드롭다운 40px 라운드10, 카드형 행 라운드12.
- **UX**: 변경 즉시 `storage.sync` 저장(저장 버튼 없음) + "✓ 저장됨" 1.5초 페이드. 헤더 상태배지(방송페이지=`● 적용 중` 그린 / 그 외=`● 대기 중` 회색). 광고차단 세션 카운터로 신뢰감.
- **접근성**: 네이티브 input/select + aria-label, `:focus-visible` 그린 아웃라인, 색+텍스트 이중 표기, `prefers-reduced-motion` 대응.
- popup.html 실동작 코드 초안 확보(§부록 — 별도 파일로 생성 예정).

---

## 5. 권한 최소화

| 권한 | 필요 | 용도 |
|---|---|---|
| `storage` | O | 옵션 저장 |
| `declarativeNetRequest` | O | 광고 도메인 정적 차단 |
| `scripting` | △ | 동적 MAIN 주입 필요 시 (정적 content_scripts로 대체 가능하면 제거) |
| `host_permissions` | O | `chzzk.naver.com` + 광고/스트림 CDN 한정 |
| `tabs` / `<all_urls>` / `webNavigation` | ✕ | 미사용(권한 최소화). SPA 감지는 content script 폴링으로 |

---

## 6. 엣지/크롬 호환
- 둘 다 Chromium → API 동일, manifest 무수정 공유 가능. `browser_specific_settings` 불필요.
- 배포 채널만 이원화(Chrome Web Store / Edge Add-ons), 각 심사 별도.

---

## 7. 유지보수·리스크
- **최대 리스크**: 치지직의 주기적 DOM 클래스/스크립트 변경 → **localStorage/네트워크 방식 우선, DOM 최소화**, 셀렉터는 `selectors.js` 중앙화 + prefix/텍스트 방어.
- 기능별 try/catch 격리(한 기능 깨져도 나머지 동작), 콘솔 경고로 조기 발견.
- 룰셋/도메인/셀렉터 상수를 한 곳에 모아 패치 용이하게.

---

## 8. 실측 결과 (2026-07-08, 라이브 방송 콘솔)

| 항목 | 실측값 | 상태 |
|---|---|---|
| 화질 localStorage 키 | `live-player-video-track` = `{"label":"1080p","width":1920,"height":1080}` | ✅ 확정 |
| 화질 옵션 | `1080p(원본)` / `720p` / `480p` / `360p` (저장 라벨은 `(원본)` 없이 `1080p`) | ✅ |
| 화질 프리셋(width×height) | 1080=1920×1080, 720=1280×720, 480=854×480, 360=640×360 | ✅ |
| 설정 버튼 | `.pzp-pc-setting-button` (`.pzp-setting-button`) | ✅ |
| 화질 진입 | `.pzp-setting-intro-quality` | ✅ |
| 화질 목록/항목 | `.pzp-setting-quality-pane__list-container` / `.pzp-ui-setting-quality-item` | ✅ |
| 선택됨 클래스 | `pzp-ui-setting-pane-item--checked` | ✅ |
| video 엘리먼트 | `video.webplayer-internal-video` (src=blob, MSE) | ✅ |
| 미드롤 광고 오버레이 | `.pzp-pc__midroll-dim` `.pzp-midroll-dimmed`, dim `.pzp-ui-dimmed` | ✅ |
| 코치마크/프로모 키 | `CHEAT_KEY_POPUP:*`, `donation_coachmark`, `nexon_play_coachmark`, `*FREE_CHEESE_TOOLTIP`, `event####` | ✅ |
| m3u8 화질 토큰 | 없음 (`slight-slit.pstatic.net/.../dvr/...`, blob+MSE) → **방식 C 제외** | ✅ |

**아직 미확정(실제 광고 재생 시 캡처 필요):**
- 광고 요청 실제 도메인/엔드포인트 → `rules/adblock.json` 보정. (현재 후보: `tvetamovie.pstatic.net`, `glad-vod.pstatic.net`, `gfp.veta.naver.com`)
- 광고 SKIP 버튼 정확 셀렉터 → `content.js`의 `SEL.skipBtn` 좁히기.
- 광고 차단 시 재생 차단(안티-애드블록) 발생 여부·강도.
- 애드블록 감지 팝업의 현재 클래스명(현재는 팝업 미노출).

---

## 9. 다음 단계
1. 위 §8 실측(필요 시 사용자 협조 또는 Chrome 확장 연결).
2. 스캐폴드 생성(manifest + 6개 파일 골격).
3. 화질(A) 먼저 구현·검증 → 팝업닫기 → 광고차단(DNR) → UI 연결.
4. 로드 언팩으로 실환경 테스트 → 셀렉터/도메인 튜닝.
