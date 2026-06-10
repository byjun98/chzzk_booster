/*
 * 치지직 부스터 — MAIN world 스크립트 (document_start)
 *
 * 광고 스케줄(VAS) 응답을 가로채 adBreaks 를 비워 "광고 없음"으로 만들고,
 * live-detail 응답의 P2P/Grid 정보를 제거해 직접 스트림 경로를 쓰게 만든다.
 *  - 요청 자체는 정상 통과(200) → 치지직 안티-애드블록에 감지되지 않음
 *  - 광고 영상이 아예 스케줄되지 않아 재생/화질에 영향 없음(버퍼링·seek 불필요)
 *
 * ISOLATED content script가 localStorage 에 '1'/'0' 을 써서 on/off 를 전달한다.
 * (MAIN world 는 chrome.storage 에 접근할 수 없으므로 localStorage 로 신호를 받는다. 미설정 시 기본 ON.)
 */
(() => {
  'use strict';

  const VAS_RE = /nam\.veta\.naver\.com\/vas/i;
  const LIVE_DETAIL_RE = /live-detail/i;
  const NOADS_FLAG = '__cb_noads';
  const GRID_BYPASS_FLAG = '__cb_grid_bypass';
  const D = (...a) => console.debug('%c[치지직부스터:MAIN]', 'color:#00FFA3', ...a);
  const flagEnabled = (key) => {
    try { return localStorage.getItem(key) !== '0'; } catch (_) { return true; }
  };
  const noAdsEnabled = () => flagEnabled(NOADS_FLAG);
  const gridBypassEnabled = () => flagEnabled(GRID_BYPASS_FLAG);

  // 응답 본문에서 adBreaks 를 빈 배열로 치환
  function stripAds(text, url) {
    try {
      const j = JSON.parse(text);
      const n = Array.isArray(j.adBreaks) ? j.adBreaks.length : -1;
      D('가로챔 · adBreaks =', n, url || '');
      if (n > 0) {
        j.adBreaks = [];
        D('→ 광고 제거(adBreaks 비움), 원래', n, '개');
        return JSON.stringify(j);
      }
    } catch (e) { D('파싱 실패(원본 유지)', e && e.message); }
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
    } catch (e) {
      D('그리드 우회 처리 실패', e && e.message);
    }
    return { data, changed };
  }

  function stripGrid(text, url) {
    try {
      const j = JSON.parse(text);
      const { data, changed } = disableGrid(j);
      if (changed) {
        D('그리드 우회 적용', url || '');
        return JSON.stringify(data);
      }
    } catch (e) {
      D('live-detail 파싱 실패(원본 유지)', e && e.message);
    }
    return text;
  }

  function makeTextResponse(res, text) {
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    if (!headers.has('content-type')) headers.set('content-type', 'application/json;charset=utf-8');
    return new Response(text, { status: res.status, statusText: res.statusText, headers });
  }

  // ── fetch 후킹 (플레이어는 fetch 로 VAS 를 요청) ──
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const req = args[0];
    const url = (req && typeof req === 'object' && 'url' in req) ? req.url : req;
    const isVas = typeof url === 'string' && VAS_RE.test(url);
    const isLiveDetail = typeof url === 'string' && LIVE_DETAIL_RE.test(url);
    let res;
    try {
      res = await origFetch.apply(this, args);
    } catch (e) {
      if (isVas) D('요청이 차단/실패함(uBlock 등이 막았을 수 있음) →', e && e.message);
      throw e;
    }
    if ((isVas && noAdsEnabled()) || (isLiveDetail && gridBypassEnabled())) {
      try {
        const text = await res.clone().text();
        let modified = text;
        if (isVas && noAdsEnabled()) modified = stripAds(modified, url);
        if (isLiveDetail && gridBypassEnabled()) modified = stripGrid(modified, url);
        if (modified !== text) {
          return makeTextResponse(res, modified);
        }
      } catch (e) { D('응답 처리 실패(원본 반환)', e && e.message); }
    } else if (isVas || isLiveDetail) {
      D('토글 OFF — 통과', url || '');
    }
    return res;
  };

  // ── XHR 후킹 (혹시 XHR 로 요청하는 경로 대비) ──
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
      ((VAS_RE.test(url) && noAdsEnabled()) || (LIVE_DETAIL_RE.test(url) && gridBypassEnabled()));
    if (shouldPatch) {
      this.addEventListener('readystatechange', function onRSC() {
        if (this.readyState === 4) {
          try {
            const original = this.responseText;
            let modified = original;
            if (VAS_RE.test(url) && noAdsEnabled()) modified = stripAds(modified, url);
            if (LIVE_DETAIL_RE.test(url) && gridBypassEnabled()) modified = stripGrid(modified, url);
            if (modified !== original) {
              // responseText 는 읽기전용이라 재정의로 덮어씀
              Object.defineProperty(this, 'responseText', { configurable: true, get: () => modified });
              Object.defineProperty(this, 'response', { configurable: true, get: () => modified });
            }
          } catch (_) {}
        }
      });
    }
    return origSend.apply(this, a);
  };

  D('MAIN world 후킹 설치됨 (fetch/XHR). flags =', (() => {
    try { return { noAds: localStorage.getItem(NOADS_FLAG), gridBypass: localStorage.getItem(GRID_BYPASS_FLAG) }; } catch (_) { return '?'; }
  })());
})();
