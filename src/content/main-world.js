(() => {
  'use strict';

  const AD_RE = /(^https?:\/\/[^/]*(?:veta|glad|ad)[^/]*\/)|\/(?:vas|vast|ad|ads)(?:[/?#]|$)/i;
  const LIVE_PLAYBACK_RE = /\/(?:live-detail|live-playback-json)(?:[/?#]|$)/i;
  const TUNNEL_RE = /\/service\/t(?:[/?#]|$)/i;
  const AD_HINT_RE = /adBreaks|skipPreRollAd/;
  const NOADS_FLAG = '__cb_noads';
  const GRID_BYPASS_FLAG = '__cb_grid_bypass';
  const DEBUG_FLAG = '__cb_debug';
  const SETTINGS_READY_EVENT = '__cb_settings_ready';
  const nativeJSONParse = JSON.parse;
  let settingsReady = false;
  let resolveSettingsReady;
  const settingsReadyPromise = new Promise((resolve) => { resolveSettingsReady = resolve; });
  document.addEventListener(SETTINGS_READY_EVENT, () => {
    if (settingsReady) return;
    settingsReady = true;
    resolveSettingsReady();
  }, { once: true });
  const waitForSettings = () => settingsReady
    ? Promise.resolve()
    : Promise.race([settingsReadyPromise, new Promise((resolve) => setTimeout(resolve, 2000))]);
  const flagEnabled = (key) => {
    try { return localStorage.getItem(key) !== '0'; } catch (_) { return true; }
  };
  const noAdsEnabled = () => flagEnabled(NOADS_FLAG);
  const gridBypassEnabled = () => flagEnabled(GRID_BYPASS_FLAG);
  // 진단 로그는 기본으로 꺼 두고, 설정에서 켰을 때에만 동작한다.
  const debugEnabled = () => {
    try { return localStorage.getItem(DEBUG_FLAG) === '1'; } catch (_) { return false; }
  };

  // ---- 진단용 광고 필드 탐지 ----
  // 치지직이 광고 정보를 암호화 터널로 옮기면서 필드 이름이 바뀌었을 가능성이 있다.
  // 광고로 의심되는 키와 미디어 주소를 모아 콘솔에 한 번씩만 보고한다.
  const DEBUG_KEY_RE = /^ads?$|^ad[A-Z_]|^(?:vast|vas|pre-?roll|mid-?roll|post-?roll|creative|commercial|skip)/i;
  const DEBUG_KEY_SUFFIX_RE = /(?:Ad|Ads|AdBreak|AdBreaks|Skip|Vast)$/;
  const DEBUG_MEDIA_RE = /\/service\/t\/|\.mp4(?:[?#]|$)|\.m3u8(?:[?#]|$)/i;
  const debugReported = new Set();

  function looksLikeAdKey(key) {
    return DEBUG_KEY_RE.test(key) || DEBUG_KEY_SUFFIX_RE.test(key);
  }

  function collectAdShape(value, path, hits, depth) {
    if (depth > 8 || hits.length >= 40 || !value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      value.slice(0, 20).forEach((item, index) => {
        collectAdShape(item, path + '[' + index + ']', hits, depth + 1);
      });
      return;
    }

    Object.keys(value).forEach((key) => {
      if (hits.length >= 40) return;
      const child = value[key];
      const childPath = path ? path + '.' + key : key;
      const keyLooksAd = looksLikeAdKey(key);

      if (typeof child === 'string') {
        if (keyLooksAd || DEBUG_MEDIA_RE.test(child)) {
          hits.push(childPath + ' = ' + child.slice(0, 300));
        }
        return;
      }
      if (child === null || typeof child !== 'object') {
        if (keyLooksAd) hits.push(childPath + ' = ' + String(child));
        return;
      }
      if (keyLooksAd) {
        hits.push(childPath + ' = <' + (Array.isArray(child) ? 'array(' + child.length + ')' : 'object') + '>');
      }
      collectAdShape(child, childPath, hits, depth + 1);
    });
  }

  function reportAdShape(value, source) {
    if (!debugEnabled()) return;
    const hits = [];
    try { collectAdShape(value, '', hits, 0); } catch (_) { return; }
    if (!hits.length) return;

    const signature = source + '|' + hits.join('\n');
    if (debugReported.has(signature)) return;
    debugReported.add(signature);
    try {
      if (typeof console !== 'undefined' && console.info) {
        console.info('[치지직 부스터] 광고 후보 필드 (' + source + ')\n' + hits.join('\n'));
      }
    } catch (_) {}
  }

  // 영상 광고가 JSON이 아니라 VAST(XML)로 내려오는 경우를 잡기 위한 진단용 훅이다.
  const vastReported = new Set();
  function reportVast(text) {
    const key = text.slice(0, 200);
    if (vastReported.has(key)) return;
    vastReported.add(key);
    const skipOffset = (text.match(/skipoffset\s*=\s*"([^"]*)"/i) || [])[1] || '(없음)';
    const duration = (text.match(/<Duration[^>]*>\s*(?:<!\[CDATA\[)?\s*([0-9:.]+)/i) || [])[1] || '(없음)';
    const mediaFiles = (text.match(/https?:\/\/[^\s"'<\]]+/g) || [])
      .filter((url) => /\.mp4|\.m3u8|\/service\/t\//i.test(url))
      .slice(0, 5);
    try {
      if (typeof console !== 'undefined' && console.info) {
        console.info('[치지직 부스터] VAST 영상 광고 감지', {
          스킵가능시점: skipOffset,
          길이: duration,
          영상주소: mediaFiles,
          본문앞부분: text.slice(0, 1200),
        });
      }
    } catch (_) {}
  }

  if (typeof DOMParser !== 'undefined' && DOMParser.prototype && DOMParser.prototype.parseFromString) {
    const origParseFromString = DOMParser.prototype.parseFromString;
    DOMParser.prototype.parseFromString = function (text, type, ...rest) {
      const doc = origParseFromString.call(this, text, type, ...rest);
      try {
        if (debugEnabled() && typeof text === 'string' && /<VAST|<MediaFile|<Ad[\s>]/i.test(text)) {
          reportVast(text);
        }
      } catch (_) {}
      return doc;
    };
  }

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

  // livePlaybackJson 처럼 JSON 문자열로 중첩된 필드 안쪽의 광고 정보까지 정리한다.
  function stripAdsNestedJson(value) {
    let changed = false;
    if (!value || typeof value !== 'object') return changed;

    if (Array.isArray(value)) {
      value.forEach((item) => { if (stripAdsNestedJson(item)) changed = true; });
      return changed;
    }

    Object.keys(value).forEach((key) => {
      const child = value[key];
      if (typeof child === 'string') {
        if (!AD_HINT_RE.test(child)) return;
        try {
          const parsed = nativeJSONParse(child);
          if (stripAdsParsedValue(parsed)) {
            value[key] = JSON.stringify(parsed);
            changed = true;
          }
        } catch (_) {}
      } else if (stripAdsNestedJson(child)) {
        changed = true;
      }
    });
    return changed;
  }

  // 이미 파싱된 객체에 광고 제거를 적용한다(SDK 터널처럼 텍스트를 만질 수 없는 경로용).
  function stripAdsParsedValue(value) {
    if (!value || typeof value !== 'object') return false;
    let changed = clearAdBreaks(value);
    if (forceSkipPreroll(value)) changed = true;
    if (stripAdsNestedJson(value)) changed = true;
    return changed;
  }

  function stripAds(text) {
    try {
      const j = nativeJSONParse(text);
      reportAdShape(j, 'fetch/XHR 본문');
      let changed = clearAdBreaks(j);
      if (forceSkipPreroll(j)) changed = true;
      if (changed) {
        return JSON.stringify(j);
      }
    } catch (_) {}
    return text;
  }

  function removePlaybackP2P(playback) {
    let changed = false;
    if (!playback || typeof playback !== 'object') return changed;

    if (playback.meta && Object.prototype.hasOwnProperty.call(playback.meta, 'p2p') && playback.meta.p2p !== false) {
      playback.meta.p2p = false;
      changed = true;
    }

    if (Array.isArray(playback.api)) {
      const filtered = playback.api.filter((api) => {
        const name = api && typeof api.name === 'string' ? api.name : '';
        const path = api && typeof api.path === 'string' ? api.path : '';
        return !/p2p/i.test(name) && !/(?:^|\/)p2p(?:\/|$)/i.test(path);
      });
      if (filtered.length !== playback.api.length) {
        playback.api = filtered;
        changed = true;
      }
    }

    const removePaths = (value) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(removePaths);
        return;
      }
      ['p2pPath', 'p2pPathUrlEncoding'].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          delete value[key];
          changed = true;
        }
      });
      Object.values(value).forEach(removePaths);
    };
    removePaths(playback.media);
    return changed;
  }

  function disableGrid(data) {
    let changed = false;
    try {
      const content = data && data.content;
      if (!content || typeof content !== 'object') return { data, changed };

      if ('p2pQuality' in content && (!Array.isArray(content.p2pQuality) || content.p2pQuality.length > 0)) {
        content.p2pQuality = [];
        changed = true;
      }

      if ('pq' in content && (!Array.isArray(content.pq) || content.pq.length > 0)) {
        content.pq = [];
        changed = true;
      }

      ['livePlaybackJson', 'playbackJson'].forEach((key) => {
        if (!content[key]) return;
        const wasString = typeof content[key] === 'string';
        let playback = null;
        try {
          playback = wasString ? nativeJSONParse(content[key]) : content[key];
        } catch (_) {
          playback = null;
        }

        if (removePlaybackP2P(playback)) {
          content[key] = wasString ? JSON.stringify(playback) : playback;
          changed = true;
        }
      });
    } catch (_) {}
    return { data, changed };
  }

  function stripGrid(text) {
    try {
      const j = nativeJSONParse(text);
      const { data, changed } = disableGrid(j);
      if (changed) {
        return JSON.stringify(data);
      }
    } catch (_) {}
    return text;
  }

  function disableGridParsedValue(value) {
    if (!value || typeof value !== 'object') return false;

    let changed = false;
    const candidates = [value];
    if (value.data && typeof value.data === 'object') candidates.push(value.data);

    candidates.forEach((candidate) => {
      if (!candidate || typeof candidate !== 'object') return;

      if (candidate.content && typeof candidate.content === 'object') {
        if (disableGrid(candidate).changed) changed = true;
      } else if (
        'p2pQuality' in candidate ||
        'pq' in candidate ||
        'livePlaybackJson' in candidate ||
        'playbackJson' in candidate
      ) {
        if (disableGrid({ content: candidate }).changed) changed = true;
      } else if (candidate.meta && candidate.media) {
        if (removePlaybackP2P(candidate)) changed = true;
      }
    });

    return changed;
  }

  // 최신 치지직은 live-detail을 fetch/XHR 대신 플레이어 SDK 터널로 받아올 수 있다.
  // SDK가 복호화한 JSON이 페이지 코드로 전달되는 지점에서 같은 P2P 보정을 적용한다.
  JSON.parse = function (...args) {
    const value = nativeJSONParse.apply(this, args);
    if (gridBypassEnabled()) disableGridParsedValue(value);
    // 광고 정보도 터널 경로로만 내려오므로 여기서 함께 제거한다.
    // 전체 트리 순회 비용을 줄이려고, 원본 문자열에 광고 필드가 보일 때만 처리한다.
    const raw = args[0];
    if (noAdsEnabled() && typeof raw === 'string' && AD_HINT_RE.test(raw)) stripAdsParsedValue(value);
    // 터널 응답은 SDK가 복호화한 뒤 이 지점을 지나므로, 새 광고 필드를 찾기에 가장 좋은 자리다.
    reportAdShape(value, 'SDK 터널(JSON.parse)');
    return value;
  };

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
    const url = typeof req === 'string'
      ? req
      : (req && typeof req.url === 'string')
        ? req.url
        : (req && typeof req.href === 'string')
          ? req.href
          : '';
    const isLivePlayback = typeof url === 'string' && LIVE_PLAYBACK_RE.test(url);
    const isTunnel = typeof url === 'string' && TUNNEL_RE.test(url);
    if (isLivePlayback) await waitForSettings();
    let res;
    try {
      res = await origFetch.apply(this, args);
    } catch (err) {
      throw err;
    }
    const shouldPatchAds = shouldStripAds(url, res);
    if (shouldPatchAds || ((isLivePlayback || isTunnel) && gridBypassEnabled())) {
      try {
        const text = await res.clone().text();
        let modified = text;
        if (shouldPatchAds) modified = stripAds(modified);
        if ((isLivePlayback || isTunnel) && gridBypassEnabled()) modified = stripGrid(modified);
        if (modified !== text) return makeTextResponse(res, modified);
      } catch (_) {}
    }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__cb_url = typeof url === 'string' ? url : (url && typeof url.href === 'string' ? url.href : '');
    return origOpen.call(this, method, url, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    const url = this.__cb_url;
    const isLivePlayback = typeof url === 'string' && LIVE_PLAYBACK_RE.test(url);
    const isTunnel = typeof url === 'string' && TUNNEL_RE.test(url);
    const shouldPatch =
      typeof url === 'string' &&
      ((noAdsEnabled() && (AD_RE.test(url) || /chzzk|naver/i.test(url))) || isLivePlayback || isTunnel);
    if (shouldPatch) {
      this.addEventListener('readystatechange', function onRSC() {
        if (this.readyState === 4) {
          // 터널 응답은 responseType 이 arraybuffer 라 responseText 접근만으로 예외가 난다.
          // 이 경로는 SDK 가 복호화한 뒤 JSON.parse 훅에서 처리하므로 여기서는 건너뛴다.
          const responseType = this.responseType;
          if (responseType && responseType !== 'text') return;
          try {
            const original = this.responseText;
            let modified = original;
            const contentType = this.getResponseHeader('content-type') || '';
            if (noAdsEnabled() && (AD_RE.test(url) || /json/i.test(contentType))) modified = stripAds(modified);
            if ((isLivePlayback || isTunnel) && gridBypassEnabled()) modified = stripGrid(modified);
            if (modified !== original) {
              // 오래된 우회 스크립트가 뒤에서 불완전한 응답으로 다시 덮어쓰지 못하게 고정한다.
              Object.defineProperty(this, 'responseText', { configurable: false, get: () => modified });
              Object.defineProperty(this, 'response', { configurable: false, get: () => modified });
            }
          } catch (_) {}
        }
      }, { capture: true });
    }
    if (isLivePlayback && !settingsReady) {
      const xhr = this;
      waitForSettings().then(() => origSend.apply(xhr, a));
      return;
    }
    return origSend.apply(this, a);
  };
})();
