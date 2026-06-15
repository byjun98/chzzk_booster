(() => {
  'use strict';

  const AD_RE = /(^https?:\/\/[^/]*(?:veta|glad|ad)[^/]*\/)|\/(?:vas|vast|ad|ads)(?:[/?#]|$)/i;
  const LIVE_DETAIL_RE = /live-detail/i;
  const NOADS_FLAG = '__cb_noads';
  const GRID_BYPASS_FLAG = '__cb_grid_bypass';
  const flagEnabled = (key) => {
    try { return localStorage.getItem(key) !== '0'; } catch (_) { return true; }
  };
  const noAdsEnabled = () => flagEnabled(NOADS_FLAG);
  const gridBypassEnabled = () => flagEnabled(GRID_BYPASS_FLAG);

  function clearAdBreaks(value) {
    let changed = false;
    if (!value || typeof value !== 'object') return changed;

    if (Array.isArray(value)) {
      value.forEach((item) => { if (clearAdBreaks(item)) changed = true; });
      return changed;
    }

    Object.keys(value).forEach((key) => {
      if (key === 'adBreaks' && Array.isArray(value[key]) && value[key].length > 0) {
        value[key] = [];
        changed = true;
      } else if (clearAdBreaks(value[key])) {
        changed = true;
      }
    });
    return changed;
  }

  // 치지직 API 응답의 skipPreRollAd 를 true 로 강제 → 플레이어가 프리롤 광고를 건너뛰게 유도
  function forceSkipPreroll(value) {
    let changed = false;
    if (!value || typeof value !== 'object') return changed;
    if (Array.isArray(value)) {
      value.forEach((item) => { if (forceSkipPreroll(item)) changed = true; });
      return changed;
    }
    Object.keys(value).forEach((key) => {
      if (key === 'skipPreRollAd' && value[key] !== true) {
        value[key] = true;
        changed = true;
      } else if (forceSkipPreroll(value[key])) {
        changed = true;
      }
    });
    return changed;
  }

  function stripAds(text) {
    try {
      const j = JSON.parse(text);
      let changed = clearAdBreaks(j);
      if (forceSkipPreroll(j)) changed = true;
      if (changed) {
        return JSON.stringify(j);
      }
    } catch (_) {}
    return text;
  }

  function disableGrid(data) {
    let changed = false;
    try {
      const content = data && data.content;
      if (!content) return { data, changed };

      if ('p2pQuality' in content && (!Array.isArray(content.p2pQuality) || content.p2pQuality.length > 0)) {
        content.p2pQuality = [];
        changed = true;
      }

      if (content.livePlaybackJson) {
        const wasString = typeof content.livePlaybackJson === 'string';
        let playback = null;
        try {
          playback = wasString ? JSON.parse(content.livePlaybackJson) : content.livePlaybackJson;
        } catch (_) {
          playback = null;
        }

        if (playback && typeof playback === 'object') {
          let playbackChanged = false;
          if (playback.meta && Object.prototype.hasOwnProperty.call(playback.meta, 'p2p') && playback.meta.p2p !== false) {
            playback.meta.p2p = false;
            playbackChanged = true;
          }

          if (Array.isArray(playback.media)) {
            playback.media.forEach((media) => {
              if (!Array.isArray(media.encodingTrack)) return;
              media.encodingTrack.forEach((track) => {
                if (track && Object.prototype.hasOwnProperty.call(track, 'p2pPath')) {
                  delete track.p2pPath;
                  playbackChanged = true;
                }
                if (track && Object.prototype.hasOwnProperty.call(track, 'p2pPathUrlEncoding')) {
                  delete track.p2pPathUrlEncoding;
                  playbackChanged = true;
                }
              });
            });
          }

          if (playbackChanged) {
            content.livePlaybackJson = wasString ? JSON.stringify(playback) : playback;
            changed = true;
          }
        }
      }
    } catch (_) {}
    return { data, changed };
  }

  function stripGrid(text) {
    try {
      const j = JSON.parse(text);
      const { data, changed } = disableGrid(j);
      if (changed) {
        return JSON.stringify(data);
      }
    } catch (_) {}
    return text;
  }

  function makeTextResponse(res, text) {
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    if (!headers.has('content-type')) headers.set('content-type', 'application/json;charset=utf-8');
    return new Response(text, { status: res.status, statusText: res.statusText, headers });
  }

  function shouldStripAds(url, res) {
    if (!noAdsEnabled() || typeof url !== 'string') return false;
    if (AD_RE.test(url)) return true;
    const contentType = res && res.headers && res.headers.get('content-type');
    return /chzzk|naver/i.test(url) && /json/i.test(contentType || '');
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const req = args[0];
    const url = (req && typeof req === 'object' && 'url' in req) ? req.url : req;
    const isLiveDetail = typeof url === 'string' && LIVE_DETAIL_RE.test(url);
    let res;
    try {
      res = await origFetch.apply(this, args);
    } catch (err) {
      throw err;
    }
    const shouldPatchAds = shouldStripAds(url, res);
    if (shouldPatchAds || (isLiveDetail && gridBypassEnabled())) {
      try {
        const text = await res.clone().text();
        let modified = text;
        if (shouldPatchAds) modified = stripAds(modified);
        if (isLiveDetail && gridBypassEnabled()) modified = stripGrid(modified);
        if (modified !== text) {
          return makeTextResponse(res, modified);
        }
      } catch (_) {}
    }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__cb_url = url;
    return origOpen.call(this, method, url, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    const url = this.__cb_url;
    const shouldPatch =
      typeof url === 'string' &&
      ((noAdsEnabled() && (AD_RE.test(url) || /chzzk|naver/i.test(url))) || (LIVE_DETAIL_RE.test(url) && gridBypassEnabled()));
    if (shouldPatch) {
      this.addEventListener('readystatechange', function onRSC() {
        if (this.readyState === 4) {
          try {
            const original = this.responseText;
            let modified = original;
            const contentType = this.getResponseHeader('content-type') || '';
            if (noAdsEnabled() && (AD_RE.test(url) || /json/i.test(contentType))) modified = stripAds(modified);
            if (LIVE_DETAIL_RE.test(url) && gridBypassEnabled()) modified = stripGrid(modified);
            if (modified !== original) {
              Object.defineProperty(this, 'responseText', { configurable: true, get: () => modified });
              Object.defineProperty(this, 'response', { configurable: true, get: () => modified });
            }
          } catch (_) {}
        }
      });
    }
    return origSend.apply(this, a);
  };
})();
