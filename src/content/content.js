/*
 * 치지직 부스터 — content script (ISOLATED world, document_start)
 *
 * 역할:
 *   1) 화질 자동 설정: localStorage 'live-player-video-track' 선주입(주력) + DOM 강제전환(옵션)
 *   2) 광고 SKIP 버튼 자동 클릭 / 광고차단 감지 팝업 닫기
 *   3) 프로모·코치마크 팝업 localStorage 선점("이미 봤음" 위장)
 *   4) MAIN world fetch/XHR 후킹 옵션 신호 전달(광고 제거, 그리드 우회)
 *   5) 치지직 SPA(방송 이동) 감지 후 재적용
 *
 * 참고: 셀렉터/키는 2026-07 라이브 방송 실측 기준. 치지직 업데이트 시
 *       아래 상수 블록만 수정하면 된다(방어적으로 prefix/텍스트 매칭 병행).
 */
(() => {
  'use strict';

  // ────────────────────────────────────────────────────────────
  // 실측 기반 상수 (유지보수 시 이 블록만 수정)
  // ────────────────────────────────────────────────────────────
  const LS_QUALITY_KEY = 'live-player-video-track';

  // 옵션 값(문자열) → 플레이어 localStorage 트랙 객체
  const QUALITY_PRESETS = {
    '1080p': { label: '1080p', width: 1920, height: 1080 },
    '720p':  { label: '720p',  width: 1280, height: 720 },
    '480p':  { label: '480p',  width: 854,  height: 480 },
    '360p':  { label: '360p',  width: 640,  height: 360 },
  };

  const SEL = {
    video:        'video.webplayer-internal-video, video',
    settingBtn:   '.pzp-pc-setting-button, .pzp-setting-button',
    qualityIntro: '.pzp-setting-intro-quality',
    qualityList:  '.pzp-setting-quality-pane__list-container',
    qualityItem:  '.pzp-ui-setting-quality-item',
    checkedCls:   'pzp-ui-setting-pane-item--checked',
    settingsPanel:'.pzp-settings',
    midrollDim:   '.pzp-midroll-dimmed, .pzp-pc__midroll-dim',
  };
  // 안티-애드블록 팝업 식별 문구
  const ADBLOCK_POPUP_RE = /광고\s*차단\s*프로그램/;

  // 프로모/코치마크/이벤트 팝업: 존재 시 '봤음'으로 선점할 localStorage 키 패턴
  const PROMO_LS_PATTERNS = [
    /CHEAT_KEY_POPUP/i, /CHEAT_KEY_TOOLTIP/i, /donation_coachmark/i,
    /nexon_play_coachmark/i, /FREE_CHEESE_TOOLTIP/i, /^event\d+$/i,
    /homeSkinCollapsedUntil/i,
  ];

  // ────────────────────────────────────────────────────────────
  // 옵션 (chrome.storage.sync 에서 로드; 아래는 기본값)
  // ────────────────────────────────────────────────────────────
  const opts = {
    autoQuality: true,   // 화질 자동 설정 on/off
    quality: '1080p',    // 목표 화질
    forceDOM: false,     // 설정 메뉴 자동 조작(호환모드). 기본 OFF: localStorage만으로 적용(메뉴 안 열림). localStorage로 안 되는 방송에서만 켬
    gridBypass: true,    // live-detail 응답의 P2P/Grid 경로 제거(MAIN world)
    // 광고 처리(우선순위: VAS 제거 → SKIP 클릭). 각각 독립 on/off.
    adBlockVas: true,    // [1순위] VAS 응답의 adBreaks 제거 → 광고 자체를 안 부름(MAIN world)
    adSkip: true,        // [2순위] 광고 SKIP 버튼 자동 클릭(안전망)
    autoclose: true,     // 팝업/코치마크 자동 닫기
  };

  const log = (...a) => console.debug('%c[치지직부스터]', 'color:#00FFA3', ...a);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // MAIN world 스크립트에 on/off 신호 전달(localStorage 공유)
  function syncMainWorldFlags(preserveExisting = false) {
    const setFlag = (key, on) => {
      if (preserveExisting && localStorage.getItem(key) !== null) return;
      localStorage.setItem(key, on ? '1' : '0');
    };
    try {
      setFlag('__cb_noads', opts.adBlockVas);
      setFlag('__cb_grid_bypass', opts.gridBypass);
    } catch (_) {}
  }

  // ────────────────────────────────────────────────────────────
  // 화질 — 방식 A: localStorage 선주입 (권한/DOM 불필요, 깜빡임 없음)
  // ────────────────────────────────────────────────────────────
  function applyQualityLS() {
    if (!opts.autoQuality) return;
    const preset = QUALITY_PRESETS[opts.quality];
    if (!preset) return;
    try {
      const want = JSON.stringify(preset);
      if (localStorage.getItem(LS_QUALITY_KEY) !== want) {
        localStorage.setItem(LS_QUALITY_KEY, want);
        log('localStorage 화질 적용 →', opts.quality);
      }
    } catch (_) { /* localStorage 접근 실패 무시 */ }
  }

  // 설정 UI를 시각적으로만 숨김(프로그래매틱 클릭은 그대로 동작). 조작 중 오른쪽 패널 깜빡임 방지.
  const HIDE_STYLE_ID = '__cb_hide_settings';
  function hideSettingsUI(on) {
    let s = document.getElementById(HIDE_STYLE_ID);
    if (on) {
      if (!s) {
        s = document.createElement('style');
        s.id = HIDE_STYLE_ID;
        // 설정 버튼/패널을 안 보이게(opacity) 하되 레이아웃·클릭은 유지
        // pzp 설정 UI(버튼/팝오버/모든 설정 pane)를 통째로 투명 처리 + 클릭 차단
        s.textContent =
          '[class*="pzp-setting"],[class*="pzp-pc-setting"],[class*="pzp-pc__setting"]' +
          '{opacity:0!important;pointer-events:none!important;}';
        (document.head || document.documentElement).appendChild(s);
      }
    } else if (s) {
      s.remove();
    }
  }

  // 화질 — 방식 B: 설정 메뉴 DOM 강제전환 (사용자에겐 안 보이게 처리)
  let enforceRunning = false;
  async function enforceQualityDOM() {
    if (!opts.autoQuality || !opts.forceDOM) return;
    if (enforceRunning) return;   // 중복 실행 방지
    // 안티-애드블록 감지 상태에선 플레이어가 광고 초기화 재시도 루프라 화질 조작이 무의미(깜빡임만 유발) → 스킵
    if (document.body && ADBLOCK_POPUP_RE.test(document.body.textContent || '')) {
      log('안티-애드블록 활성 → 화질 강제 보류');
      return;
    }
    const target = opts.quality; // 예: '1080p'  →  '1080p(원본) ...' 텍스트에 접두 일치
    const btn = document.querySelector(SEL.settingBtn);
    if (!btn) return;
    enforceRunning = true;
    hideSettingsUI(true);         // 조작 시작 전 숨김
    // 안전장치: 만에 하나 finally 가 안 돌아도 설정 UI가 영영 숨지 않도록 3초 뒤 강제 복구
    const safety = setTimeout(() => { hideSettingsUI(false); enforceRunning = false; }, 3000);
    try {
      btn.click();
      await wait(140);
      const intro = document.querySelector(SEL.qualityIntro);
      if (intro) {
        intro.click();
        await wait(140);
        const items = [...document.querySelectorAll(`${SEL.qualityList} ${SEL.qualityItem}`)];
        let matched = false;
        for (const it of items) {
          if (it.textContent.trim().startsWith(target)) {
            if (!it.classList.contains(SEL.checkedCls)) { it.click(); log('DOM 화질 전환 →', target); }
            matched = true;
            break;
          }
        }
        // 목표 화질이 없는 방송이면 최상단(최고화질) 선택
        if (!matched && items[0] && !items[0].classList.contains(SEL.checkedCls)) {
          items[0].click();
          log('DOM 화질: 목표 없음 → 최고화질 선택');
        }
        await wait(80);
      }
    } catch (e) {
      log('DOM 화질 전환 실패', e);
    } finally {
      // 설정 패널 닫기: Escape → 그래도 열려 있으면 설정 버튼 재클릭
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch (_) {}
      const panel = document.querySelector(SEL.settingsPanel);
      if (panel && panel.offsetParent !== null) { try { btn.click(); } catch (_) {} }
      await wait(60);             // 패널이 닫힌 뒤에 숨김 해제(닫히는 모습도 안 보이게)
      clearTimeout(safety);
      hideSettingsUI(false);
      enforceRunning = false;
    }
  }

  // ────────────────────────────────────────────────────────────
  // 팝업/코치마크 localStorage 선점
  // ────────────────────────────────────────────────────────────
  function seedPromoLS() {
    if (!opts.autoclose) return;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && PROMO_LS_PATTERNS.some((re) => re.test(k)) && !localStorage.getItem(k)) {
          localStorage.setItem(k, 'true');
        }
      }
    } catch (_) {}
  }

  // ────────────────────────────────────────────────────────────
  // 광고차단 감지 팝업 닫기 + 광고 SKIP 자동 클릭
  // ────────────────────────────────────────────────────────────
  function handleAds() {
    if (opts.autoclose) closeAdblockPopup();
    // 우선순위: (1순위 VAS 제거는 MAIN world에서 선처리) → 2순위 SKIP 클릭(안전망)
    if (opts.adSkip) {
      const skip = findAdSkipButton();
      if (skip) { skip.click(); bumpAdCount(); log('광고 SKIP 클릭'); }
    }
  }

  // 실제 사용자 클릭에 가깝게 이벤트 시퀀스를 발생(React onClick/pointer 대응)
  function fullClick(el) {
    const opts2 = { bubbles: true, cancelable: true, view: window };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      try { el.dispatchEvent(new MouseEvent(type, opts2)); } catch (_) {}
    });
  }

  // 안티-애드블록 "광고 차단 프로그램을 사용 중이신가요?" 팝업 제거
  function closeAdblockPopup() {
    if (!document.body || !ADBLOCK_POPUP_RE.test(document.body.textContent || '')) return false;
    const candidates = document.querySelectorAll('div, section, article');
    for (const el of candidates) {
      const t = el.textContent || '';
      if (t.length < 500 && ADBLOCK_POPUP_RE.test(t)) {
        // 1) 확인 버튼을 실제 클릭 시퀀스로 눌러 정상 dismiss 시도
        const btn = [...el.querySelectorAll('button')].find((b) => /확인|닫기|취소/.test(b.textContent || ''));
        if (btn) fullClick(btn);

        // 2) 클릭이 안 먹어도 안 보이도록: '뷰포트를 거의 덮지 않는' 최상위 조상(모달 카드)까지만 올라가 숨김
        //    거대한 레이아웃/앱 루트는 절대 숨기지 않는다(페이지 블랭크 방지).
        const isHuge = (node) => {
          const r = node.getBoundingClientRect();
          return r.width > window.innerWidth * 0.9 && r.height > window.innerHeight * 0.9;
        };
        let card = el;
        while (
          card.parentElement &&
          card.parentElement !== document.body &&
          !isHuge(card.parentElement)
        ) {
          card = card.parentElement;
        }
        if (card && card !== document.body && !isHuge(card)) {
          card.style.setProperty('display', 'none', 'important');
        }
        // 3) 백드롭/딤 및 스크롤 락 원복
        document.querySelectorAll(SEL.midrollDim + ', .pzp-ui-dimmed').forEach((d) => (d.style.display = 'none'));
        document.documentElement.style.overflow = '';
        if (document.body) document.body.style.overflow = '';

        log('안티-애드블록 팝업 제거');
        return true;
      }
    }
    return false;
  }

  // 광고 SKIP 버튼만 정확히 탐지 (실시간/기타 버튼 오클릭 방지)
  function findAdSkipButton() {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.offsetParent === null) continue; // 화면에 보이는 것만
      const meta = `${b.getAttribute('aria-label') || ''} ${b.className || ''} ${b.textContent || ''}`;
      // "광고" 문맥 + skip/스킵/건너뛰기  또는  명시적 ad-skip 클래스
      if (/(광고[\s\S]{0,6}(skip|스킵|건너))|ad[-_]?skip/i.test(meta)) return b;
    }
    return null;
  }

  function bumpAdCount() {
    try { chrome.runtime.sendMessage({ type: 'AD_SKIPPED' }); } catch (_) {}
  }

  // ────────────────────────────────────────────────────────────
  // 플레이어 등장/재초기화 감지 → 화질 강제 적용
  //  (최초 진입, 방송 이동, 광고/버퍼링 후 video 엘리먼트 교체 시마다 재적용)
  // ────────────────────────────────────────────────────────────
  let lastVideoEl = null;
  let enforceTimers = [];
  function scheduleEnforce() {
    if (!opts.autoQuality || !opts.forceDOM) return;
    enforceTimers.forEach(clearTimeout);
    // 플레이어가 뜬 직후엔 메뉴가 준비 안 될 수 있어 두 번 시도
    enforceTimers = [1200, 3500].map((d) => setTimeout(enforceQualityDOM, d));
  }
  function onPlayerMaybeReady() {
    const v = document.querySelector(SEL.video);
    if (!v) return;
    if (v !== lastVideoEl) {   // 새 플레이어(최초/방송이동/광고 후 리셋)
      lastVideoEl = v;
      applyQualityLS();
      scheduleEnforce();
    }
  }

  // ────────────────────────────────────────────────────────────
  // 메인 루프 + SPA 이동 감지
  // ────────────────────────────────────────────────────────────
  let lastHref = location.href;
  function tick() {
    if (location.href !== lastHref) {  // SPA로 방송 이동
      lastHref = location.href;
      applyQualityLS();
      seedPromoLS();
    }
    applyQualityLS();      // 버퍼링/광고 후 리셋 대비 재적용
    onPlayerMaybeReady();  // video 엘리먼트 교체 시 화질 재적용
    handleAds();
  }

  // ────────────────────────────────────────────────────────────
  // 부팅
  // ────────────────────────────────────────────────────────────
  function boot() {
    // document_start 시점: 스토리지 로드 전이라도 기본값으로 즉시 선주입
    applyQualityLS();
    seedPromoLS();
    syncMainWorldFlags(true);   // 저장소 로드 전에는 이전 off 플래그를 덮지 않음

    if (chrome?.storage?.sync) {
      chrome.storage.sync.get({ ...opts }, (s) => {
        Object.assign(opts, s);
        applyQualityLS();
        seedPromoLS();
        syncMainWorldFlags();
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        for (const k in changes) if (k in opts) opts[k] = changes[k].newValue;
        applyQualityLS();
        syncMainWorldFlags();
      });
    }

    setInterval(tick, 1000);

    // 플레이어가 늦게 삽입되므로 DOM 변화도 감시
    const mo = new MutationObserver(() => onPlayerMaybeReady());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  boot();
})();
