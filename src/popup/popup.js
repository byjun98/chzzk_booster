const DEFAULTS = { autoQuality: true, quality: '1080p', gridBypass: true, adBlockVas: true, adSpeedup: true, adSkip: true, autoclose: true };
const $ = (s) => document.querySelector(s);
const savedFlag = $('#saved');

function flashSaved() {
  savedFlag.classList.add('show');
  clearTimeout(flashSaved.t);
  flashSaved.t = setTimeout(() => savedFlag.classList.remove('show'), 1500);
}

function save() {
  const adOn = $('#adblock').checked;
  chrome.storage.sync.set({
    adBlockVas: adOn,
    adSpeedup: adOn,
    adSkip: adOn,
    autoclose: $('#autoclose').checked,
    gridBypass: $('#gridBypass').checked,
    autoQuality: $('#autoQuality').checked,
    quality: $('#quality').value,
  }, flashSaved);
}

['adblock', 'autoclose', 'gridBypass', 'autoQuality', 'quality'].forEach((id) =>
  $('#' + id).addEventListener('change', save));

chrome.storage.sync.get(DEFAULTS, (s) => {
  $('#adblock').checked = s.adBlockVas || s.adSpeedup || s.adSkip;
  $('#autoclose').checked = s.autoclose;
  $('#gridBypass').checked = s.gridBypass;
  $('#autoQuality').checked = s.autoQuality;
  $('#quality').value = s.quality;
});

function renderCount() {
  chrome.storage.local.get({ adSkipCount: 0 }, ({ adSkipCount }) => {
    $('#adCount').textContent = adSkipCount > 0 ? `광고 ${adSkipCount}개 스킵됨` : '광고 스킵 준비됨';
  });
}
renderCount();

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const on = tab && tab.url && tab.url.includes('chzzk.naver.com');
  if (on) {
    $('#statusText').textContent = '적용 중';
  } else {
    $('#statusBadge').classList.add('idle');
    $('#statusText').textContent = '대기 중';
  }
});

$('#openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
