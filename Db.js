/**
 * 도움 벼룩시장 — DB 계층 (시트 내장형)
 * 이 스크립트가 내장된 스프레드시트 자체가 DB입니다. 시트 사본 = 코드+DB 통째 복사.
 * 외부 서버·API 키 불필요.
 */

var SHEET_SCHEMA = {
  '설정': ['키', '값'],
  '반': ['session_id', '반이름', '반코드', '상태', '모드', '스포트라이트', '생성시각'],
  '학생': ['session_id', '학번', '이름', '짝학번', '입장시각'],
  '포스트잇': ['id', 'session_id', '학번', '유형', '내용', '매칭여부', '매칭상대학번', '숨김', '작성시각'],
  '매칭기록': ['id', 'session_id', '학생A학번', '학생B학번', '내용', '기록시각'],
  '성찰': ['session_id', '학번', '줄때마음', '받을때마음', '작성시각']
};

// 활동 상태 흐름: 대기 → 작성 → 시장 → 성찰 → 종료
var STATUSES = ['대기', '작성', '시장', '성찰', '종료'];
var MODES = ['자유', '짝'];

function getSs_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * 최초 1회: 시트/헤더 생성 + 기본 설정 + 설명서 탭.
 * 메뉴 [🧺 도움 벼룩시장] → ① DB 초기화. 여러 번 실행해도 안전합니다.
 */
function setupDatabase() {
  var ss = getSs_();
  Object.keys(SHEET_SCHEMA).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    var headers = SHEET_SCHEMA[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    // 학번·반 코드 등 숫자 자동 변환 방지 — 전체 텍스트 서식 강제
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
    sheet.setFrozenRows(1);
  });
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);

  if (getSetting_('교사코드') === null) setSetting_('교사코드', String(Math.floor(100000 + Math.random() * 900000)));
  touch_();

  buildManualSheet_();
  return ss.getUrl();
}

/** 변경 토큰 갱신 — 클라이언트 폴링이 변경분만 다시 불러오게 하는 기준값 */
function touch_() {
  setSetting_('갱신토큰', String(new Date().getTime()));
}

function getToken_() {
  return getSetting_('갱신토큰') || '0';
}

// ---------- 공통 헬퍼 ----------

function readAll_(sheetName) {
  var sheet = getSs_().getSheetByName(sheetName);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(String);
  return values.slice(1).filter(function (row) {
    return row.join('') !== '';
  }).map(function (row, i) {
    var obj = { _row: i + 2 };
    headers.forEach(function (h, c) { obj[h] = String(row[c]); });
    return obj;
  });
}

function appendRow_(sheetName, obj) {
  var sheet = getSs_().getSheetByName(sheetName);
  var headers = SHEET_SCHEMA[sheetName];
  var row = headers.map(function (h) { return obj[h] !== undefined ? String(obj[h]) : ''; });
  sheet.appendRow(row);
}

function updateRow_(sheetName, rowIndex, obj) {
  var sheet = getSs_().getSheetByName(sheetName);
  var headers = SHEET_SCHEMA[sheetName];
  var row = headers.map(function (h) { return obj[h] !== undefined ? String(obj[h]) : ''; });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
}

function deleteRowsWhere_(sheetName, predicate) {
  var rows = readAll_(sheetName).filter(predicate);
  rows.sort(function (a, b) { return b._row - a._row; });
  rows.forEach(function (r) { getSs_().getSheetByName(sheetName).deleteRow(r._row); });
  return rows.length;
}

function getSetting_(key) {
  var rows = readAll_('설정');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['키'] === key) return rows[i]['값'];
  }
  return null;
}

function setSetting_(key, value) {
  var rows = readAll_('설정');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['키'] === key) {
      updateRow_('설정', rows[i]._row, { '키': key, '값': value });
      return;
    }
  }
  appendRow_('설정', { '키': key, '값': value });
}

/** 날짜는 항상 ISO 문자열로만 주고받는다 (Date 객체 직접 전달 금지) */
function nowIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss");
}

function shortId_() {
  return Utilities.getUuid().slice(0, 8);
}

// ---------- 반(세션) — 여러 반이 한 시트를 공유, 데이터는 session_id로 완전 분리 ----------

function findSessionByCode_(code) {
  var rows = readAll_('반');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['반코드'] === String(code).trim()) return rows[i];
  }
  return null;
}

function findSessionById_(sessionId) {
  var rows = readAll_('반');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].session_id === String(sessionId)) return rows[i];
  }
  return null;
}

/** 4자리 반 코드 생성 (기존 반과 중복 방지) */
function generateCode_() {
  var existing = {};
  readAll_('반').forEach(function (s) { existing[s['반코드']] = true; });
  for (var i = 0; i < 50; i++) {
    var code = String(Math.floor(1000 + Math.random() * 9000));
    if (!existing[code]) return code;
  }
  throw new Error('반 코드 생성에 실패했습니다. 다시 시도해 주세요.');
}

function findStudent_(sessionId, sid) {
  var rows = readAll_('학생');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].session_id === String(sessionId) && rows[i]['학번'] === String(sid)) return rows[i];
  }
  return null;
}

function findPostit_(id) {
  var rows = readAll_('포스트잇');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === String(id)) return rows[i];
  }
  return null;
}

// ---------- 📖 설명서 탭 ----------

function buildManualSheet_() {
  var ss = getSs_();
  var name = '📖 설명서';
  var sheet = ss.getSheetByName(name);
  if (sheet) sheet.clear();
  else sheet = ss.insertSheet(name, 0);

  var C = { title: '#7a5c2e', section: '#f3e8d5', warn: '#fcefdc', tip: '#e5f2e0', text: '#4a3f35', muted: '#8a7c6d' };

  var rows = [
    ['title', '🧺 도움 벼룩시장 — 사용 설명서', ''],
    ['sub', '"받는 행복과 주는 행복, 오늘 둘 다 느껴보는 게 목표입니다." | 시트 사본 = 코드+DB 통째 복사', ''],
    ['blank', '', ''],
    ['section', '1. 앱 소개', ''],
    ['text', '• 학생들이 "내가 줄 수 있는 도움"(초록 포스트잇)과 "받고 싶은 도움"(노랑 포스트잇)을 디지털 게시판에 붙이고, 교실에서 직접 짝을 찾아 나눈 뒤 기록·성찰하는 학급 활동입니다.', ''],
    ['text', '• 화면 3종: 학생용(모바일) / 전광판(빔프로젝터, 읽기 전용) / 교사용(활동 제어). 하나의 웹앱 주소에서 링크로 분기됩니다.', ''],
    ['text', '• 활동 흐름: 대기 → 작성 → 시장 열림 → 성찰 → 종료. 교사 화면에서 단계를 넘기면 학생 화면이 자동으로 바뀝니다.', ''],
    ['text', '• 여러 반 운영: 교사 화면에서 반을 만들 때마다 반 코드가 발급되고, 반마다 데이터·진행 단계가 완전히 분리됩니다. 시트 하나로 전 학급 운영!', ''],
    ['blank', '', ''],
    ['section', '2. 사전 준비물', ''],
    ['kv', '구글 계정', '교사용 하나면 충분 (학생은 계정 불필요 — 반 코드+학번+이름 입장)'],
    ['kv', 'API 키', '필요 없습니다! 외부 서버·AI 없이 구글시트만으로 동작합니다'],
    ['blank', '', ''],
    ['section', '3. 설치 방법 (★ 순서대로 4단계)', ''],
    ['kv', 'STEP 1', '이 파일이 사본이 맞는지 확인 — 원본이라면 [파일]→[사본 만들기] 후 사본에서 진행'],
    ['kv', 'STEP 2', '시트 상단 메뉴 [🧺 도움 벼룩시장] → [① DB 초기화] 클릭 → 권한 승인'],
    ['warn', '⚠ "확인되지 않은 앱" 경고가 떠도 정상입니다: [고급] → [안전하지 않은 페이지로 이동] → [허용]. 본인 소유 스크립트라 안전합니다.', ''],
    ['tip', '💡 이어서 [④ 교사 코드 재설정]을 꼭 눌러 나만의 교사 코드를 만드세요. (사본에는 원본의 교사 코드가 복사되어 있습니다)', ''],
    ['kv', 'STEP 3', '[확장 프로그램] → [Apps Script] → [배포] → [새 배포] → 유형 "웹 앱" → 실행: 나 / 액세스: 모든 사용자 → [배포] → URL 복사'],
    ['kv', 'STEP 4', '[🧺 도움 벼룩시장] → [③ 링크 만들기] → 복사한 URL 붙여넣기 → 학생용/전광판/교사용 링크가 자동 생성됩니다'],
    ['blank', '', ''],
    ['section', '4. 수업 진행 순서', ''],
    ['kv', '⓪ 반 만들기', '교사 화면(교사 코드로 입장) → [새 반 만들기] → 반 이름 입력 → 4자리 반 코드 발급'],
    ['kv', '① 입장', '학생용 링크 + 반 코드를 칠판에 공유 → 학생들이 학번+이름으로 입장'],
    ['kv', '② 작성', '교사 화면에서 상태를 [작성]으로 → 학생들이 초록·노랑 포스트잇을 각 1개 이상 작성'],
    ['kv', '③ 시장 열림', '상태를 [시장]으로 → 전광판을 빔프로젝터에 띄우고, 학생들이 서로의 포스트잇을 보며 교실에서 직접 짝을 찾아 나눔 → 나눈 뒤 학생 화면에서 [나눔 기록]. 한 포스트잇으로 여러 친구와 반복 나눔도 가능해요'],
    ['kv', '④ 성찰', '상태를 [성찰]로 → "도움을 줄 때/받을 때 어떤 마음이었나" 두 질문에 답'],
    ['kv', '⑤ 종료', '상태를 [종료]로 → 결과는 이 시트의 포스트잇/매칭기록/성찰 탭에서 바로 확인'],
    ['tip', '💡 짝 모드: 교사 화면에서 모드를 [짝]으로 바꾸면 무작위 2인씩 묶여 서로의 포스트잇만 보입니다. 처음엔 [자유 시장] 모드를 추천해요.', ''],
    ['tip', '💡 스포트라이트: 매칭이 안 된 포스트잇을 교사 화면에서 선택하면 전광판에 "주인을 찾습니다"로 크게 띄워줍니다.', ''],
    ['blank', '', ''],
    ['section', '5. 시트(탭) 구성 — 자동 기록되므로 직접 수정은 최소화하세요', ''],
    ['kv', '설정', '교사코드 등 (교사코드는 교사 화면 입장용 — 학생에게 알려주지 마세요)'],
    ['kv', '반', '만들어진 반 목록: 반 코드·진행 상태·모드 (교사 화면 사용 권장)'],
    ['kv', '학생 / 포스트잇', '입장한 학생 / 작성된 포스트잇 (자동, 반별 분리)'],
    ['kv', '매칭기록 / 성찰', '나눔 기록 / 성찰 답변 (자동)'],
    ['warn', '⚠ 학번 열은 텍스트 서식이 강제되어 있습니다 (앞자리 0 유실 방지). 서식을 바꾸지 마세요.', ''],
    ['blank', '', ''],
    ['section', '6. 자주 묻는 질문 (FAQ)', ''],
    ['kv', '코드를 수정했어요', '[배포]→[배포 관리]→연필 아이콘→"새 버전"→[배포] 해야 반영됩니다 (URL은 유지). 안 하면 수정이 반영되지 않아요.'],
    ['kv', 'URL을 잃어버렸어요', 'Apps Script → [배포] → [배포 관리]에서 확인, 또는 [③ 링크 만들기] 재실행'],
    ['kv', '다음 반 수업에 또 쓰려면', '교사 화면에서 [새 반 만들기]만 하면 됩니다 — 반마다 데이터가 분리되어 포스트잇이 섞이지 않아요. 학기 말 정리는 메뉴 [전체 활동 데이터 삭제]'],
    ['kv', '테스트해보고 싶어요', '메뉴 [테스트 데이터 생성] → "테스트 반(샘플)"과 가상 학생(김하늘·이도윤·박새봄)이 생깁니다. 전광판에 표시된 반 코드를 넣어 바로 확인'],
    ['blank', '', ''],
    ['section', '7. 저작권 및 문의', ''],
    ['text', '• 교육 목적으로 자유롭게 사용·수정할 수 있습니다. 재배포 시 출처를 남겨 주세요.', ''],
    ['kv', '📧 이메일', 'zsq123@naver.com'],
    ['kv', '💬 오픈카톡', 'https://open.kakao.com/me/dalpjh'],
    ['kv', '📷 인스타그램', '@happygenie_ssam'],
    ['tip', '💡 사용 후기나 개선 아이디어는 언제든 환영합니다!', '']
  ];

  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(2, 760);

  rows.forEach(function (r, i) {
    var row = i + 1;
    var style = r[0];
    if (style === 'kv') {
      sheet.getRange(row, 1).setValue(r[1]).setFontWeight('bold').setFontColor(C.title).setVerticalAlignment('top');
      sheet.getRange(row, 2).setValue(r[2]).setWrap(true).setFontColor(C.text).setVerticalAlignment('top');
      return;
    }
    var range = sheet.getRange(row, 1, 1, 2).merge();
    range.setValue(r[1]).setWrap(true).setVerticalAlignment('top');
    if (style === 'title') range.setFontSize(16).setFontWeight('bold').setFontColor('#ffffff').setBackground(C.title);
    else if (style === 'sub') range.setFontColor(C.muted);
    else if (style === 'section') range.setFontWeight('bold').setBackground(C.section).setFontColor(C.title);
    else if (style === 'warn') range.setBackground(C.warn);
    else if (style === 'tip') range.setBackground(C.tip);
    else range.setFontColor(C.text);
  });
  sheet.setHiddenGridlines(true);
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(1);
}
