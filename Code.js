/**
 * 도움 벼룩시장 — 진입점 + 시트 관리 메뉴
 *
 * 이중 배포 모델:
 *  1) 시트 사본 배포(다른 교사): GAS 웹앱이 화면(HtmlService)까지 직접 서빙 → 사본 하나로 설치 끝
 *  2) GitHub Pages(원 개발자): 같은 HTML 파일을 정적 호스팅, ?api=<배포ID> 파라미터로
 *     이 스크립트의 doPost JSON API를 호출 → git push 한 번으로 화면 업데이트
 *
 * 개발·배포: clasp 사용. 코드 수정 후에는 반드시 [배포]→[배포 관리]→[새 버전] 재배포 (URL 유지).
 */

/** 화면 서빙: ?view=board / ?view=teacher / (기본) 학생 */
function doGet(e) {
  var view = (e && e.parameter && e.parameter.view) || 'index';
  if (view !== 'board' && view !== 'teacher') view = 'index';
  var titles = { index: '도움 벼룩시장', board: '도움 벼룩시장 — 전광판', teacher: '도움 벼룩시장 — 교사' };
  return HtmlService.createTemplateFromFile(view)
    .evaluate()
    .setTitle(titles[view])
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** GitHub Pages 프론트용 JSON API — { action, args } → 동일한 서버 함수 호출 */
function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var actions = {
      joinStudent: joinStudent, getStudentState: getStudentState,
      addPostit: addPostit, recordShare: recordShare, submitReflection: submitReflection,
      getBoardState: getBoardState,
      generateReflectionCard: generateReflectionCard,
      teacherLogin: teacherLogin, getTeacherState: getTeacherState,
      teacherCreateSession: teacherCreateSession, teacherDeleteSession: teacherDeleteSession,
      teacherSetStatus: teacherSetStatus, teacherSetMode: teacherSetMode,
      teacherShufflePairs: teacherShufflePairs, teacherSpotlight: teacherSpotlight,
      teacherHidePostit: teacherHidePostit
    };
    var fn = actions[String(req.action || '')];
    if (!fn) out = { ok: false, error: '알 수 없는 요청입니다.' };
    else out = fn.apply(null, req.args || []);
  } catch (err) {
    out = { ok: false, error: '잘못된 요청 형식입니다.' };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== 시트 커스텀 메뉴 ====================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🧺 도움 벼룩시장')
    .addItem('① DB 초기화 (최초 1회)', 'menuSetup')
    .addItem('② Gemini API 키 설정 (성찰 응원 메시지용)', 'menuSetApiKey')
    .addItem('③ 웹앱 배포 방법 안내', 'menuDeployHelp')
    .addItem('④ 링크 만들기', 'menuMakeLinks')
    .addItem('⑤ 교사 코드 재설정', 'menuResetTeacherCode')
    .addSeparator()
    .addItem('테스트 데이터 생성 (시연용)', 'menuSeed')
    .addItem('테스트 데이터 삭제', 'menuSeedDelete')
    .addItem('전체 활동 데이터 삭제 (모든 반)', 'menuResetActivity')
    .addToUi();
}

function menuSetup() {
  setupDatabase();
  SpreadsheetApp.getUi().alert('🧺 DB 초기화 완료!',
    '시트 탭과 기본 설정이 준비되었습니다.\n' +
    '교사 코드: ' + getSetting_('교사코드') + ' (교사 화면 입장용 — 학생에게 비공개)\n\n' +
    '반 코드는 교사 화면에서 [새 반 만들기]를 하면 반마다 발급됩니다.\n' +
    '여러 반을 동시에 운영해도 데이터가 반별로 완전히 분리돼요.\n\n' +
    '이어서 [② Gemini API 키 설정]과 [③ 웹앱 배포 방법 안내]를 진행하세요.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuSetApiKey() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Gemini API 키 설정',
    'Google AI Studio(aistudio.google.com)에서 발급한 API 키를 붙여넣으세요.\n' +
    '키는 이 스크립트 속성에만 저장되며 학생에게 노출되지 않습니다.\n\n' +
    '이 키가 있어야 성찰 단계에서 AI 응원 메시지가 생성됩니다. 설정하지 않아도\n' +
    '나머지 기능(포스트잇·나눔·전광판 등)은 그대로 사용할 수 있어요.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var key = res.getResponseText().trim();
  if (!key) { ui.alert('키가 비어 있습니다.'); return; }
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  ui.alert('저장되었습니다. 이제 성찰 제출 시 AI 응원 메시지가 함께 만들어져요.');
}

function menuDeployHelp() {
  SpreadsheetApp.getUi().alert('웹앱 배포 방법',
    '1. 시트 메뉴: 확장 프로그램 → Apps Script\n' +
    '2. 우측 상단 [배포] → 새 배포 → 유형 "웹 앱"\n' +
    '3. 실행 사용자: 나 / 액세스 권한: 모든 사용자\n' +
    '4. 발급된 웹앱 URL을 복사\n' +
    '5. 시트 메뉴 [④ 링크 만들기]에 붙여넣으면 학생/전광판/교사 링크가 생성됩니다\n\n' +
    '★ 코드를 수정한 뒤에는 [배포]→[배포 관리]→[새 버전]으로 재배포해야 반영됩니다 (URL은 유지).',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuMakeLinks() {
  var ui = SpreadsheetApp.getUi();
  var stored = getSetting_('웹앱주소') || '';
  var res = ui.prompt('링크 만들기',
    '웹앱 배포 URL을 붙여넣으세요.\n(예: https://script.google.com/macros/s/AKfycb.../exec)\n\n' +
    (stored ? '※ 이전에 저장한 주소가 있습니다. 비워 두고 [확인]을 누르면 저장된 주소로 다시 표시합니다.' : ''),
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var input = res.getResponseText().trim();
  var url = input || stored;
  if (!url) { ui.alert('배포 URL을 입력해 주세요. [③ 웹앱 배포 방법 안내]를 참고하세요.'); return; }
  if (input) setSetting_('웹앱주소', url);

  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:8px 4px">' +
    '<p style="margin:0 0 6px"><b>학생용 링크</b> (반 코드는 교사 화면에서 반을 만들면 발급됩니다)</p>' +
    '<input style="width:100%;padding:8px;font-size:12px" value="' + url + '" onclick="this.select()" readonly>' +
    '<p style="margin:14px 0 6px"><b>전광판</b> (빔프로젝터에 띄우고 반 코드 입력)</p>' +
    '<input style="width:100%;padding:8px;font-size:12px" value="' + url + '?view=board" onclick="this.select()" readonly>' +
    '<p style="margin:14px 0 6px"><b>교사 화면</b> (교사 코드 ' + getSetting_('교사코드') + ' 로 입장)</p>' +
    '<input style="width:100%;padding:8px;font-size:12px" value="' + url + '?view=teacher" onclick="this.select()" readonly>' +
    '<p style="color:#888;font-size:12px;margin-top:14px">입력창을 클릭하면 전체 선택됩니다. Ctrl+C로 복사하세요.</p>' +
    '</div>'
  ).setWidth(560).setHeight(330);
  ui.showModalDialog(html, '완성 링크');
}

/** 사본을 받은 교사는 반드시 실행 — 원본의 교사 코드가 사본에 그대로 복사되기 때문 */
function menuResetTeacherCode() {
  var code = String(Math.floor(100000 + Math.random() * 900000));
  setSetting_('교사코드', code);
  touch_();
  SpreadsheetApp.getUi().alert('교사 코드가 재설정되었습니다: ' + code +
    '\n(설정 시트에서 언제든 확인할 수 있어요. 교사 화면은 다시 로그인해야 합니다.)');
}

function menuSeed() {
  var r = seedTestData_();
  SpreadsheetApp.getUi().alert('테스트 데이터 생성 완료',
    '반: ' + r.session_name + ' (반 코드 ' + r.code + ')\n' +
    '가상 학생: ' + r.students.join(', ') + '\n' +
    '포스트잇 ' + r.postits + '개 (매칭 1건 포함)\n\n' +
    '전광판에 반 코드 ' + r.code + '를 입력하면 바로 볼 수 있습니다.\n확인 후 [테스트 데이터 삭제]로 정리하세요.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuSeedDelete() {
  var n = deleteSeedData_();
  SpreadsheetApp.getUi().alert(n > 0 ? '테스트 데이터를 삭제했습니다.' : '삭제할 테스트 데이터가 없습니다.');
}

/** 모든 반의 활동 데이터 삭제 (학기 정리용) — 반별 삭제는 교사 화면에서 */
function menuResetActivity() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert('전체 활동 데이터 삭제',
    '모든 반과 학생·포스트잇·매칭기록·성찰 데이터를 삭제합니다.\n' +
    '(반 하나만 지우려면 교사 화면의 반 [삭제] 버튼을 쓰세요)\n계속할까요?',
    ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;
  ['반', '학생', '포스트잇', '매칭기록', '성찰'].forEach(function (name) {
    deleteRowsWhere_(name, function () { return true; });
  });
  touch_();
  ui.alert('초기화되었습니다. 교사 화면에서 새 반을 만들어 시작하세요.');
}
