const RULESET_ID = 'adblock';

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
  } catch (_) {}
}

chrome.runtime.onInstalled.addListener(syncRuleset);
chrome.runtime.onStartup.addListener(syncRuleset);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.hardBlock) syncRuleset();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'AD_SKIPPED') {
    chrome.storage.local.get({ adSkipCount: 0 }, ({ adSkipCount }) => {
      chrome.storage.local.set({ adSkipCount: adSkipCount + 1 });
    });
  }
});
