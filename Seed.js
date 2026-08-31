/**
 * 도움 벼룩시장 — 테스트 데이터 (시연용)
 * 가상 학생 3명의 포스트잇·매칭·성찰 예시. 인물은 전부 가상.
 */

var SEED_SIDS = ['90101', '90102', '90103'];

function seedTestData_() {
  var students = [
    { sid: '90101', name: '김하늘' },
    { sid: '90102', name: '이도윤' },
    { sid: '90103', name: '박새봄' }
  ];
  var postits = [
    { sid: '90101', type: '초록', content: '수학 문제 풀이 차근차근 설명해줄 수 있어요' },
    { sid: '90101', type: '노랑', content: '체육 시간에 배드민턴 스매시 알려줄 사람' },
    { sid: '90102', type: '초록', content: '그림 그리는 법, 특히 사람 얼굴 알려줄 수 있어요' },
    { sid: '90102', type: '노랑', content: '수학 이차함수 그래프가 너무 어려워요' },
    { sid: '90103', type: '초록', content: '매점 갈 때 같이 가줄 수 있어요' },
    { sid: '90103', type: '노랑', content: '발표할 때 덜 떨리는 방법 아는 사람' }
  ];

  var created = { students: [], postits: 0 };
  students.forEach(function (st) {
    if (!findStudent_(st.sid)) {
      appendRow_('학생', { '학번': st.sid, '이름': st.name, '짝학번': '', '입장시각': nowIso_() });
      created.students.push(st.sid + ' ' + st.name);
    }
  });

  var already = readAll_('포스트잇').some(function (p) { return SEED_SIDS.indexOf(p['학번']) !== -1; });
  if (!already) {
    var ids = [];
    postits.forEach(function (p) {
      var id = shortId_();
      ids.push(id);
      appendRow_('포스트잇', {
        id: id, '학번': p.sid, '유형': p.type, '내용': p.content,
        '매칭여부': '', '매칭상대학번': '', '숨김': '', '작성시각': nowIso_()
      });
    });
    created.postits = postits.length;

    // 매칭 예시 1건: 김하늘(수학 설명) ↔ 이도윤(수학 어려움)
    var give = findPostit_(ids[0]);
    give['매칭여부'] = 'Y'; give['매칭상대학번'] = '90102';
    updateRow_('포스트잇', give._row, give);
    var need = findPostit_(ids[3]);
    need['매칭여부'] = 'Y'; need['매칭상대학번'] = '90101';
    updateRow_('포스트잇', need._row, need);
    appendRow_('매칭기록', {
      id: shortId_(), '학생A학번': '90101', '학생B학번': '90102',
      '내용': '이차함수 그래프 그리는 법을 설명해 줬어요', '기록시각': nowIso_()
    });
    appendRow_('성찰', {
      '학번': '90101', '줄때마음': '내가 아는 걸로 친구가 웃으니까 뿌듯했다.',
      '받을때마음': '도움을 청하는 게 부끄러웠는데 생각보다 별거 아니었다.', '작성시각': nowIso_()
    });
  }
  touch_();
  return { students: created.students.length ? created.students : ['(이미 존재)'], postits: created.postits };
}

function deleteSeedData_() {
  var isSeed = function (r) {
    return SEED_SIDS.indexOf(r['학번']) !== -1 ||
      SEED_SIDS.indexOf(r['학생A학번']) !== -1 || SEED_SIDS.indexOf(r['학생B학번']) !== -1;
  };
  var n = 0;
  n += deleteRowsWhere_('학생', isSeed);
  n += deleteRowsWhere_('포스트잇', isSeed);
  n += deleteRowsWhere_('매칭기록', isSeed);
  n += deleteRowsWhere_('성찰', isSeed);
  if (n) touch_();
  return n;
}
