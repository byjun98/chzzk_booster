const DEFAULTS = { autoQuality: true, quality: '1080p', forceDOM: false, gridBypass: true, adBlockVas: true, adSpeedup: true, adSkip: true, autoclose: true, hardBlock: false };
const TOGGLES = ['autoQuality', 'forceDOM', 'gridBypass', 'adBlockVas', 'adSpeedup', 'adSkip', 'autoclose', 'hardBlock'];
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

chrome.storage.sync.get(DEFAULTS, (s) => {
  $('#quality').value = s.quality;
  TOGGLES.forEach((id) => { $('#' + id).checked = s[id]; });
});

$('#quality').addEventListener('change', save);
TOGGLES.forEach((id) => $('#' + id).addEventListener('change', save));
