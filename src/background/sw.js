/*
 * 치지직 부스터 — service worker (MV3)
 *  - 광고 차단 declarativeNetRequest 룰셋 on/off (옵션 연동)
 *  - 광고 스킵 카운터 집계(세션)
 * MV3 SW는 idle 시 종료되므로 상태는 storage 에만 의존한다.
 */

const RULESET_ID = 'adblock';

// 네트워크 하드 차단은 치지직 안티-애드블록을 발동시키므로 기본 OFF.
// 'hardBlock' 옵션을 명시적으로 켠 경우에만 룰셋을 활성화한다.
async function syncRuleset() {
  try {
    const { hardBlock = false } = await chrome.storage.sync.get({ hardBlock: false });
    const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
    const isOn = enabled.includes(RULESET_ID);
    if (hardBlock && !isOn) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [RULESET_ID] });
    } else if (!hardBlock && isOn) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: [RULESET_ID] });
    }
  } catch (e) {
    console.warn('[치지직부스터] 룰셋 동기화 실패', e);
  }
}

chrome.runtime.onInstalled.addListener(syncRuleset);
chrome.runtime.onStartup.addListener(syncRuleset);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.hardBlock) syncRuleset();
});

// content script → 광고 스킵 카운트
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'AD_SKIPPED') {
    chrome.storage.local.get({ adSkipCount: 0 }, ({ adSkipCount }) => {
      chrome.storage.local.set({ adSkipCount: adSkipCount + 1 });
    });
  }
});
