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
    if (opts.adSkip) {
      const skip = findAdSkipButton();
      if (skip) { skip.click(); bumpAdCount(); }
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
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.offsetParent === null) continue;
      const meta = `${b.getAttribute('aria-label') || ''} ${b.className || ''} ${b.textContent || ''}`;
      if (/(광고[\s\S]{0,6}(skip|스킵|건너))|ad[-_]?skip/i.test(meta)) return b;
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
