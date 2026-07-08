/* 치지직 부스터 — popup 로직 */
// 팝업의 "광고 차단"은 마스터 스위치: VAS 제거 + SKIP 클릭을 한 번에 켜고 끈다.
// 세부 개별 제어는 옵션 페이지에서.
const DEFAULTS = { autoQuality: true, quality: '1080p', gridBypass: true, adBlockVas: true, adSkip: true, autoclose: true };
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
    adSkip: adOn,
    autoclose: $('#autoclose').checked,
    gridBypass: $('#gridBypass').checked,
    autoQuality: $('#autoQuality').checked,
    quality: $('#quality').value,
  }, flashSaved);
}

['adblock', 'autoclose', 'gridBypass', 'autoQuality', 'quality'].forEach((id) =>
  $('#' + id).addEventListener('change', save));

// 복원 (광고 마스터는 둘 중 하나라도 켜져 있으면 ON으로 표시)
chrome.storage.sync.get(DEFAULTS, (s) => {
  $('#adblock').checked = s.adBlockVas || s.adSkip;
  $('#autoclose').checked = s.autoclose;
  $('#gridBypass').checked = s.gridBypass;
  $('#autoQuality').checked = s.autoQuality;
  $('#quality').value = s.quality;
});

// 광고 스킵 카운터
function renderCount() {
  chrome.storage.local.get({ adSkipCount: 0 }, ({ adSkipCount }) => {
    $('#adCount').textContent = adSkipCount > 0 ? `광고 ${adSkipCount}개 스킵됨` : '광고 스킵 준비됨';
  });
}
renderCount();

// 현재 탭이 치지직인지 → 상태 배지
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
