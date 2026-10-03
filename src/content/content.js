(() => {
  'use strict';

  const LS_QUALITY_KEY = 'live-player-video-track';

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

  const ADBLOCK_POPUP_RE = /광고\s*차단\s*프로그램/;
  const SETTINGS_READY_EVENT = '__cb_settings_ready';
  // 치지직이 광고 영상을 자체 API 도메인의 암호화 터널(/service/t/…)로 내려주기 시작했다.
  // 라이브 본편은 MSE(blob: 주소)로 재생되므로, 이 주소를 그대로 쓰는 video 는 광고로 확정할 수 있다.
  const TUNNEL_MEDIA_RE = /^https?:\/\/[^/]*chzzk[^/]*\/service\/t\//i;

  const PROMO_LS_PATTERNS = [
    /CHEAT_KEY_POPUP/i, /CHEAT_KEY_TOOLTIP/i, /donation_coachmark/i,
    /nexon_play_coachmark/i, /FREE_CHEESE_TOOLTIP/i, /^event\d+$/i,
    /homeSkinCollapsedUntil/i,
  ];

  const opts = {
    autoQuality: true,
    quality: '1080p',
    forceDOM: false,
    gridBypass: true,
    adBlockVas: true,
    adSpeedup: true,
    adSkip: true,
    autoclose: true,
    debug: false,
  };

  function debugLog(...args) {
    if (!opts.debug) return;
    try { console.info('[치지직 부스터]', ...args); } catch (_) {}
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function syncMainWorldFlags(preserveExisting = false) {
    const setFlag = (key, on) => {
      if (preserveExisting && localStorage.getItem(key) !== null) return;
      localStorage.setItem(key, on ? '1' : '0');
    };
    try {
      setFlag('__cb_noads', opts.adBlockVas);
      setFlag('__cb_grid_bypass', opts.gridBypass);
      setFlag('__cb_debug', opts.debug);
    } catch (_) {}
  }

  function notifyMainWorldSettingsReady() {
    document.dispatchEvent(new CustomEvent(SETTINGS_READY_EVENT));
  }

  function applyQualityLS() {
    if (!opts.autoQuality) return;
    const preset = QUALITY_PRESETS[opts.quality];
    if (!preset) return;
    try {
      const want = JSON.stringify(preset);
      if (localStorage.getItem(LS_QUALITY_KEY) !== want) {
        localStorage.setItem(LS_QUALITY_KEY, want);
      }
    } catch (_) {}
  }

  const HIDE_STYLE_ID = '__cb_hide_settings';
  function hideSettingsUI(on) {
    let s = document.getElementById(HIDE_STYLE_ID);
    if (on) {
      if (!s) {
        s = document.createElement('style');
        s.id = HIDE_STYLE_ID;
        s.textContent =
          '[class*="pzp-setting"],[class*="pzp-pc-setting"],[class*="pzp-pc__setting"]' +
          '{opacity:0!important;pointer-events:none!important;}';
        (document.head || document.documentElement).appendChild(s);
      }
    } else if (s) {
      s.remove();
    }
  }

  let enforceRunning = false;
  async function enforceQualityDOM() {
    if (!opts.autoQuality || !opts.forceDOM) return;
    if (enforceRunning) return;
    if (document.body && ADBLOCK_POPUP_RE.test(document.body.textContent || '')) return;

    const target = opts.quality;
    const btn = document.querySelector(SEL.settingBtn);
    if (!btn) return;

    enforceRunning = true;
    hideSettingsUI(true);
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
            if (!it.classList.contains(SEL.checkedCls)) it.click();
            matched = true;
            break;
          }
        }
        if (!matched && items[0] && !items[0].classList.contains(SEL.checkedCls)) {
          items[0].click();
        }
        await wait(80);
      }
    } catch (_) {
    } finally {
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch (_) {}
      const panel = document.querySelector(SEL.settingsPanel);
      if (panel && panel.offsetParent !== null) { try { btn.click(); } catch (_) {} }
      await wait(60);
      clearTimeout(safety);
      hideSettingsUI(false);
      enforceRunning = false;
    }
  }

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

  function handleAds() {
    if (opts.autoclose) closeAdblockPopup();
    ensureAdPoller();
  }

  // 재생 주소가 암호화 터널을 가리키는 video 는 광고로 확정한다.
  // 라이브 본편은 MSE 로 재생되어 주소가 blob: 으로 시작하므로 여기에 걸리지 않는다.
  function isTunnelAdVideo(v) {
    try { return TUNNEL_MEDIA_RE.test(v.currentSrc || v.src || ''); } catch (_) { return false; }
  }

  // 광고 영상만 선별한다.
  //  1순위: 터널 주소로 재생되는 영상(길이를 따지지 않는다. 새 광고는 파일이 매우 클 수 있다.)
  //  2순위: data-role="videoEl"(치지직 광고 영상 표식) + 유한·짧은 길이
  //  3순위: 유한·짧은 길이(라이브는 Infinity/대용량 DVR이라 절대 대상 아님)
  function getAdVideo() {
    const vids = [...document.querySelectorAll('video')];
    const isShortAd = (v) => isFinite(v.duration) && v.duration > 0 && v.duration < 300;
    return (
      vids.find(isTunnelAdVideo) ||
      vids.find((v) => isShortAd(v) && v.matches('[data-role="videoEl"]')) ||
      vids.find(isShortAd) ||
      null
    );
  }

  // 광고 UI가 떠 있는데도 광고 영상을 고르지 못하면, 화면의 video 요소를 통째로 기록한다.
  // '넘어가지 않는 광고'의 원인을 찾기 위한 진단 경로다.
  let lastUnmatchedSignature = '';
  function logUnmatchedAdUi(adUi) {
    if (!opts.debug || !adUi) return;
    const videos = [...document.querySelectorAll('video')].map((v) => ({
      주소: (v.currentSrc || v.src || '(없음)').slice(0, 200),
      길이: v.duration,
      재생위치: v.currentTime,
      준비상태: v.readyState,
      광고표식: v.matches('[data-role="videoEl"]'),
    }));
    const signature = JSON.stringify(videos);
    if (signature === lastUnmatchedSignature) return;
    lastUnmatchedSignature = signature;
    debugLog('광고 UI는 있으나 광고 영상을 고르지 못함', {
      광고UI: adUi.className || adUi.tagName,
      UI문구: (adUi.textContent || '').trim().slice(0, 60),
      화면의영상: videos,
    });
  }

  // 광고가 떠 있는 동안 빠르게(80ms) 처리:
  //  - 배속 순삭: 광고 영상을 끝으로 점프 + 10배속 (검증된 방식; 라이브는 안 건드림)
  //  - SKIP 클릭: 카운트다운이 끝나 'SKIP'이 활성화되면 즉시 클릭
  let adPoller = null;
  function ensureAdPoller() {
    const adUi = document.querySelector(
      '.skip_area, [class*="skip_area"], .txt_skip, [class*="txt_skip"], .btn_skip, [class*="btn_skip"], [data-role="videoEl"]'
    );
    const adVideo = getAdVideo();
    if (adUi && !adVideo) logUnmatchedAdUi(adUi);
    const active = (opts.adSpeedup || opts.adSkip) && (!!adUi || !!adVideo);
    if (active) {
      if (!adPoller) adPoller = setInterval(adPollTick, 80);
    } else if (adPoller) {
      clearInterval(adPoller);
      adPoller = null;
    }
  }
  let lastLoggedAdSrc = '';
  let stuckTicks = 0;
  function logAdVideoOnce(ad) {
    if (!opts.debug) return;
    const src = (ad.currentSrc || ad.src || '(주소 없음)');
    if (src === lastLoggedAdSrc) return;
    lastLoggedAdSrc = src;
    stuckTicks = 0;
    debugLog('광고 영상 감지', {
      주소: src.slice(0, 300),
      길이: ad.duration,
      터널경로: isTunnelAdVideo(ad),
      광고표식: ad.matches('[data-role="videoEl"]'),
    });
  }

  // 끝점프를 걸었는데도 재생 위치가 따라오지 않으면(탐색이 막힌 광고) 한 번 기록한다.
  function logStuckAd(ad) {
    if (!opts.debug) return;
    if (!isFinite(ad.duration) || ad.duration - ad.currentTime <= 1) {
      stuckTicks = 0;
      return;
    }
    stuckTicks += 1;
    if (stuckTicks !== 25) return;
    let seekable = '(확인 불가)';
    try {
      const ranges = [];
      for (let i = 0; i < ad.seekable.length; i++) ranges.push([ad.seekable.start(i), ad.seekable.end(i)]);
      seekable = ranges;
    } catch (_) {}
    debugLog('끝점프가 적용되지 않는 광고', {
      주소: (ad.currentSrc || ad.src || '(없음)').slice(0, 300),
      길이: ad.duration,
      재생위치: ad.currentTime,
      배속: ad.playbackRate,
      탐색가능구간: seekable,
      일시정지: ad.paused,
    });
  }

  let lastSkipUiText = '';
  function logSkipUi() {
    if (!opts.debug) return;
    const ui = document.querySelector(
      '.skip_area, [class*="skip_area"], .btn_skip, [class*="btn_skip"], .txt_skip, [class*="txt_skip"]'
    );
    const text = ui ? (ui.textContent || '').trim().slice(0, 40) : '';
    if (text === lastSkipUiText) return;
    lastSkipUiText = text;
    if (text) debugLog('SKIP UI 문구 변화', text, '클릭대상여부', !!findAdSkipButton());
  }

  function adPollTick() {
    if (opts.adSpeedup) {
      const ad = getAdVideo();
      if (ad) {
        logAdVideoOnce(ad);
        try { if (ad.playbackRate !== 10) ad.playbackRate = 10; } catch (_) {}
        try { if (isFinite(ad.duration) && ad.currentTime < ad.duration) ad.currentTime = ad.duration; } catch (_) {}
        logStuckAd(ad);
      }
    }
    logSkipUi();
    if (opts.adSkip) {
      const b = findAdSkipButton();
      if (b) {
        debugLog('SKIP 버튼 클릭', (b.textContent || '').trim().slice(0, 40));
        b.click();
        bumpAdCount();
      }
    }
  }

  function fullClick(el) {
    const opts2 = { bubbles: true, cancelable: true, view: window };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      try { el.dispatchEvent(new MouseEvent(type, opts2)); } catch (_) {}
    });
  }

  function closeAdblockPopup() {
    if (!document.body || !ADBLOCK_POPUP_RE.test(document.body.textContent || '')) return false;
    const candidates = document.querySelectorAll('div, section, article');
    for (const el of candidates) {
      const t = el.textContent || '';
      if (t.length < 500 && ADBLOCK_POPUP_RE.test(t)) {
        const btn = [...el.querySelectorAll('button')].find((b) => /확인|닫기|취소/.test(b.textContent || ''));
        if (btn) fullClick(btn);

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

        document.querySelectorAll(SEL.midrollDim + ', .pzp-ui-dimmed').forEach((d) => (d.style.display = 'none'));
        document.documentElement.style.overflow = '';
        if (document.body) document.body.style.overflow = '';

        return true;
      }
    }
    return false;
  }

  function findAdSkipButton() {
    // 1) pzp/일반 광고 스킵 버튼
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.offsetParent === null) continue;
      const meta = `${b.getAttribute('aria-label') || ''} ${b.className || ''} ${b.textContent || ''}`;
      if (/(광고[\s\S]{0,6}(skip|스킵|건너))|ad[-_]?skip/i.test(meta)) return b;
    }
    // 2) GFP(fxview) 광고 스킵: .skip_area / .txt_skip
    //    'N초 후 SKIP' 카운트다운 중엔 무시하고, 'SKIP'만 남아 클릭 가능해졌을 때만 클릭
    //    ('광고 페이지 보기'(link_more)는 절대 클릭하지 않음)
    const gfp = document.querySelector('.skip_area, [class*="skip_area"], .btn_skip, [class*="btn_skip"], .txt_skip, [class*="txt_skip"]');
    if (gfp && gfp.offsetParent !== null) {
      const t = (gfp.textContent || '').trim();
      if (/skip/i.test(t) && !/후|초|\d/.test(t)) {
        return gfp.closest('.skip_area, [class*="skip_area"], .btn_skip, [class*="btn_skip"]') || gfp;
      }
    }
    return null;
  }

  function bumpAdCount() {
    try { chrome.runtime.sendMessage({ type: 'AD_SKIPPED' }); } catch (_) {}
  }

  let lastVideoEl = null;
  let enforceTimers = [];
  function scheduleEnforce() {
    if (!opts.autoQuality || !opts.forceDOM) return;
    enforceTimers.forEach(clearTimeout);
    enforceTimers = [1200, 3500].map((d) => setTimeout(enforceQualityDOM, d));
  }
  function onPlayerMaybeReady() {
    const v = document.querySelector(SEL.video);
    if (!v) return;
    if (v !== lastVideoEl) {
      lastVideoEl = v;
      applyQualityLS();
      scheduleEnforce();
    }
  }

  let lastHref = location.href;
  function tick() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      applyQualityLS();
      seedPromoLS();
    }
    applyQualityLS();
    onPlayerMaybeReady();
    handleAds();
  }

  function boot() {
    applyQualityLS();
    seedPromoLS();
    syncMainWorldFlags(true);

    if (chrome?.storage?.sync) {
      chrome.storage.sync.get({ ...opts }, (s) => {
        Object.assign(opts, s);
        applyQualityLS();
        seedPromoLS();
        syncMainWorldFlags();
        notifyMainWorldSettingsReady();
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        for (const k in changes) if (k in opts) opts[k] = changes[k].newValue;
        applyQualityLS();
        syncMainWorldFlags();
      });
    } else {
      syncMainWorldFlags();
      notifyMainWorldSettingsReady();
    }

    setInterval(tick, 1000);

    const mo = new MutationObserver(() => onPlayerMaybeReady());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  boot();
})();
