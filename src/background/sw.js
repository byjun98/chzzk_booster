// 설정 키 → declarativeNetRequest 룰셋 ID 대응표.
const RULESETS = {
  hardBlock: 'adblock',
  adBlockTunnelMedia: 'tunnel-ad',
};

const DEFAULTS = { hardBlock: false, adBlockTunnelMedia: false };

async function syncRulesets() {
  try {
    const settings = await chrome.storage.sync.get(DEFAULTS);
    const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
    const enableRulesetIds = [];
    const disableRulesetIds = [];

    Object.entries(RULESETS).forEach(([key, rulesetId]) => {
      const want = settings[key] === true;
      const isOn = enabled.includes(rulesetId);
      if (want && !isOn) enableRulesetIds.push(rulesetId);
      else if (!want && isOn) disableRulesetIds.push(rulesetId);
    });

    if (enableRulesetIds.length || disableRulesetIds.length) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
    }
  } catch (_) {}
}

chrome.runtime.onInstalled.addListener(syncRulesets);
chrome.runtime.onStartup.addListener(syncRulesets);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (Object.keys(RULESETS).some((key) => key in changes)) syncRulesets();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'AD_SKIPPED') {
    chrome.storage.local.get({ adSkipCount: 0 }, ({ adSkipCount }) => {
      chrome.storage.local.set({ adSkipCount: adSkipCount + 1 });
    });
  }
});
