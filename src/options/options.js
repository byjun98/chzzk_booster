/* 치지직 부스터 — 옵션 페이지 로직 */
const DEFAULTS = { autoQuality: true, quality: '1080p', forceDOM: false, gridBypass: true, adBlockVas: true, adSkip: true, autoclose: true, hardBlock: false };
const TOGGLES = ['autoQuality', 'forceDOM', 'gridBypass', 'adBlockVas', 'adSkip', 'autoclose', 'hardBlock'];
const $ = (s) => document.querySelector(s);
const saved = $('#saved');

function flashSaved() {
  saved.classList.add('show');
  clearTimeout(flashSaved.t);
  flashSaved.t = setTimeout(() => saved.classList.remove('show'), 1400);
}

function save() {
  const data = { quality: $('#quality').value };
  TOGGLES.forEach((id) => { data[id] = $('#' + id).checked; });
  chrome.storage.sync.set(data, flashSaved);
}

// 복원
chrome.storage.sync.get(DEFAULTS, (s) => {
  $('#quality').value = s.quality;
  TOGGLES.forEach((id) => { $('#' + id).checked = s[id]; });
});

// 변경 즉시 저장
$('#quality').addEventListener('change', save);
TOGGLES.forEach((id) => $('#' + id).addEventListener('change', save));
