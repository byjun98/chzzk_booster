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
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // 광고 영상만 선별: 유한·짧은 길이(라이브는 Infinity/대용량 DVR이라 절대 대상 아님).
  //  data-role="videoEl"(치지직 광고 영상 표식)을 우선하되, 최종 안전장치는 '유한 길이' 조건.
  function getAdVideo() {
    const vids = [...document.querySelectorAll('video')];
    const isAd = (v) => isFinite(v.duration) && v.duration > 0 && v.duration < 300;
    return (
      vids.find((v) => isAd(v) && v.matches('[data-role="videoEl"]')) ||
      vids.find(isAd) ||
      null
    );
  }

  // 광고가 떠 있는 동안 빠르게(80ms) 처리:
  //  - 배속 순삭: 광고 영상을 끝으로 점프 + 10배속 (검증된 방식; 라이브는 안 건드림)
  //  - SKIP 클릭: 카운트다운이 끝나 'SKIP'이 활성화되면 즉시 클릭
  let adPoller = null;
  function ensureAdPoller() {
    const adUi = document.querySelector(
      '.skip_area, [class*="skip_area"], .txt_skip, [class*="txt_skip"], .btn_skip, [class*="btn_skip"], [data-role="videoEl"]'
    );
    const active = (opts.adSpeedup || opts.adSkip) && !!adUi;
    if (active) {
      if (!adPoller) adPoller = setInterval(adPollTick, 80);
    } else if (adPoller) {
      clearInterval(adPoller);
      adPoller = null;
    }
  }
  function adPollTick() {
    if (opts.adSpeedup) {
      const ad = getAdVideo();
      if (ad) {
        try { if (ad.playbackRate !== 10) ad.playbackRate = 10; } catch (_) {}
        try { if (isFinite(ad.duration) && ad.currentTime < ad.duration) ad.currentTime = ad.duration; } catch (_) {}
      }
    }
    if (opts.adSkip) {
      const b = findAdSkipButton();
      if (b) { b.click(); bumpAdCount(); }
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
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        for (const k in changes) if (k in opts) opts[k] = changes[k].newValue;
        applyQualityLS();
        syncMainWorldFlags();
      });
    }

    setInterval(tick, 1000);

    const mo = new MutationObserver(() => onPlayerMaybeReady());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  boot();
})();
