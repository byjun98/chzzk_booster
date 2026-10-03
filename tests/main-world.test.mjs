import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/content/main-world.js', import.meta.url), 'utf8');

class FakeXMLHttpRequest {
  addEventListener() {}
  getResponseHeader() { return 'application/json'; }
  open() {}
  send() {}
}

function createHarness(payloads, { ready = true, XMLHttpRequestClass = FakeXMLHttpRequest, noAds = false, debug = false } = {}) {
  const listeners = new Map();
  const storage = new Map([
    ['__cb_noads', noAds ? '1' : '0'],
    ['__cb_grid_bypass', '1'],
    ['__cb_debug', debug ? '1' : '0'],
  ]);
  const logs = [];
  let fetchCount = 0;

  const document = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
      if (ready && type === '__cb_settings_ready') queueMicrotask(listener);
    },
  };
  const window = {
    fetch: async (url) => {
      fetchCount += 1;
      return new Response(JSON.stringify(payloads[url]), {
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  const context = vm.createContext({
    Headers,
    Promise,
    Response,
    XMLHttpRequest: XMLHttpRequestClass,
    clearTimeout,
    console: { info: (message) => logs.push(String(message)) },
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    queueMicrotask,
    setTimeout,
    window,
  });
  vm.runInContext(source, context);
  const pageJSONParse = vm.runInContext('JSON.parse', context);

  return {
    dispatchSettingsReady() {
      listeners.get('__cb_settings_ready')?.();
    },
    fetch: (...args) => window.fetch(...args),
    parse: (text) => pageJSONParse(text),
    getFetchCount: () => fetchCount,
    getLogs: () => logs,
  };
}

function assertPlaybackP2PRemoved(playback) {
  assert.equal(playback.meta.p2p, false);
  assert.deepEqual(playback.api, [{ name: 'qoeConfig', path: 'https://example.com/qoe' }]);

  const serialized = JSON.stringify(playback);
  assert.equal(serialized.includes('p2pPath'), false);
  assert.equal(serialized.includes('p2pPathUrlEncoding'), false);
}

const playback = {
  meta: { p2p: true },
  api: [
    { name: 'p2p-config', path: 'https://example.com/p2p/config' },
    { name: 'qoeConfig', path: 'https://example.com/qoe' },
  ],
  media: [{
    p2pPath: '/media-p2p.m3u8',
    p2pPathUrlEncoding: '/media-p2p-encoded.m3u8',
    encodingTrack: [{
      encodingTrackId: '1080p',
      path: 'https://example.com/1080p.m3u8',
      p2pPath: '/track-p2p.m3u8',
      p2pPathUrlEncoding: '/track-p2p-encoded.m3u8',
    }],
  }],
};

test('live-detail의 모든 P2P 정보를 제거한다', async () => {
  const url = 'https://api.chzzk.naver.com/service/v3/channels/test/live-detail?tm=false';
  const harness = createHarness({
    [url]: {
      content: {
        p2pQuality: ['1080p', '720p'],
        livePlaybackJson: JSON.stringify(playback),
      },
    },
  });

  const result = await (await harness.fetch(url)).json();
  assert.deepEqual(result.content.p2pQuality, []);
  assertPlaybackP2PRemoved(JSON.parse(result.content.livePlaybackJson));
});

test('live-playback-json의 playbackJson과 pq를 처리한다', async () => {
  const url = 'https://api.chzzk.naver.com/service/v1.1/channels/test/live-playback-json?tm=false';
  const harness = createHarness({
    [url]: {
      content: {
        playbackJson: JSON.stringify(playback),
        pq: ['1080p', '720p'],
        tmp: false,
      },
    },
  });

  const result = await (await harness.fetch(url)).json();
  assert.deepEqual(result.content.pq, []);
  assertPlaybackP2PRemoved(JSON.parse(result.content.playbackJson));
});

test('플레이어 SDK 터널이 역직렬화한 라이브 응답도 보정한다', () => {
  const harness = createHarness({});
  const result = harness.parse(JSON.stringify({
    content: {
      p2pQuality: ['1080p', '720p'],
      livePlaybackJson: JSON.stringify(playback),
    },
  }));

  assert.equal(result.content.p2pQuality.length, 0);
  assertPlaybackP2PRemoved(JSON.parse(result.content.livePlaybackJson));
});

test('저장 설정을 읽기 전에는 라이브 재생 요청을 보내지 않는다', async () => {
  const url = 'https://api.chzzk.naver.com/service/v3/channels/test/live-detail';
  const harness = createHarness({
    [url]: { content: { p2pQuality: [], livePlaybackJson: '{}' } },
  }, { ready: false });

  const pending = harness.fetch(url);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harness.getFetchCount(), 0);

  harness.dispatchSettingsReady();
  await pending;
  assert.equal(harness.getFetchCount(), 1);
});

test('오래된 XHR 우회 스크립트가 완전한 보정 결과를 다시 덮어쓰지 못한다', async () => {
  const url = 'https://api.chzzk.naver.com/service/v3/channels/test/live-detail';
  const originalPayload = {
    content: {
      p2pQuality: ['1080p', '720p'],
      livePlaybackJson: JSON.stringify(playback),
    },
  };

  class TestXMLHttpRequest {
    constructor() {
      this.listeners = [];
      this.readyState = 0;
      this.responseBody = JSON.stringify(originalPayload);
    }
    addEventListener(type, listener, options) {
      if (type === 'readystatechange') {
        this.listeners.push({ listener, capture: options === true || options?.capture === true });
      }
    }
    get response() { return this.responseBody; }
    get responseText() { return this.responseBody; }
    getResponseHeader() { return 'application/json'; }
    open(method, requestUrl) { this.requestUrl = requestUrl; }
    send() {
      this.readyState = 4;
      this.listeners
        .toSorted((a, b) => Number(b.capture) - Number(a.capture))
        .forEach(({ listener }) => listener.call(this));
    }
  }

  const harness = createHarness({}, { ready: false, XMLHttpRequestClass: TestXMLHttpRequest });

  const wrappedSend = TestXMLHttpRequest.prototype.send;
  TestXMLHttpRequest.prototype.send = function legacySend(...args) {
    this.addEventListener('readystatechange', function legacyPatch() {
      if (this.readyState !== 4) return;
      try {
        const data = JSON.parse(this.responseText);
        data.content.p2pQuality = [];
        Object.defineProperty(this, 'responseText', {
          get: () => JSON.stringify(data),
        });
      } catch (_) {}
    });
    return wrappedSend.apply(this, args);
  };

  harness.dispatchSettingsReady();
  const xhr = new TestXMLHttpRequest();
  xhr.open('GET', url);
  xhr.send();

  const result = JSON.parse(xhr.responseText);
  assertPlaybackP2PRemoved(JSON.parse(result.content.livePlaybackJson));
});

test('터널로 내려온 광고 정보를 JSON.parse 단계에서 제거한다', () => {
  const harness = createHarness({}, { noAds: true });
  const result = harness.parse(JSON.stringify({
    content: {
      skipPreRollAd: false,
      adBreaks: [{ position: 'pre' }],
      livePlaybackJson: JSON.stringify({
        meta: { p2p: false },
        adBreaks: [{ position: 'mid', duration: 15 }],
      }),
    },
  }));

  assert.equal(result.content.adBreaks.length, 0);
  assert.equal(result.content.skipPreRollAd, true);
  assert.equal(JSON.parse(result.content.livePlaybackJson).adBreaks.length, 0);
});

test('arraybuffer 로 내려오는 터널 응답에서는 responseText 를 읽지 않는다', () => {
  const url = 'https://api.chzzk.naver.com/service/t/abcd/efgh';

  class ArrayBufferXHR {
    constructor() {
      this.listeners = [];
      this.readyState = 0;
      this.responseType = 'arraybuffer';
    }
    addEventListener(type, listener) {
      if (type === 'readystatechange') this.listeners.push(listener);
    }
    get responseText() { throw new Error('responseText 에 접근하면 안 된다'); }
    getResponseHeader() { return 'application/octet-stream'; }
    open(method, requestUrl) { this.requestUrl = requestUrl; }
    send() {
      this.readyState = 4;
      this.listeners.forEach((listener) => listener.call(this));
    }
  }

  const harness = createHarness({}, { ready: false, XMLHttpRequestClass: ArrayBufferXHR });
  harness.dispatchSettingsReady();

  const xhr = new ArrayBufferXHR();
  xhr.open('GET', url);
  assert.doesNotThrow(() => xhr.send());
});

test('진단 로그를 켜면 터널 응답의 광고 후보 필드를 보고한다', () => {
  const harness = createHarness({}, { debug: true });
  harness.parse(JSON.stringify({
    content: {
      adControlType: 'STUDIO_CONTROL',
      adCount: 2,
      creativeUrl: 'https://api.chzzk.naver.com/service/t/abc/def/ghi',
      title: '광고와 무관한 값',
    },
  }));

  const report = harness.getLogs().join('\n');
  assert.match(report, /광고 후보 필드/);
  assert.match(report, /content\.adControlType = STUDIO_CONTROL/);
  assert.match(report, /content\.adCount = 2/);
  assert.match(report, /content\.creativeUrl = https:\/\/api\.chzzk\.naver\.com\/service\/t\//);
  assert.equal(report.includes('content.title'), false);
});

test('같은 광고 응답을 여러 번 만나도 한 번만 보고한다', () => {
  const harness = createHarness({}, { debug: true });
  const payload = JSON.stringify({ adBreaks: [{ position: 0 }] });
  harness.parse(payload);
  harness.parse(payload);

  assert.equal(harness.getLogs().length, 1);
});

test('진단 로그가 꺼져 있으면 아무것도 기록하지 않는다', () => {
  const harness = createHarness({});
  harness.parse(JSON.stringify({ content: { adControlType: 'STUDIO_CONTROL' } }));

  assert.equal(harness.getLogs().length, 0);
});
