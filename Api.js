/**
 * 도움 벼룩시장 — google.script.run 서버 API
 * 모든 함수는 JSON 직렬화 가능한 객체만 반환하고, 날짜는 ISO 문자열로만 주고받는다.
 * 오류는 { ok:false, error } 로 반환 (withFailureHandler 의존 최소화).
 */

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function err_(msg) { return { ok: false, error: msg }; }

// ==================== 학생 ====================

/** 입장: 반 코드 + 학번 + 이름. 재접속 시 기존 정보 유지. */
function joinStudent(code, sid, name) {
  try {
    code = String(code || '').trim(); sid = String(sid || '').trim(); name = String(name || '').trim();
    if (!code || !sid || !name) return err_('반 코드, 학번, 이름을 모두 입력해 주세요.');
    if (code !== getSetting_('반코드')) return err_('반 코드가 올바르지 않습니다.');
    return withLock_(function () {
      var st = findStudent_(sid);
      if (!st) {
        appendRow_('학생', { '학번': sid, '이름': name, '짝학번': '', '입장시각': nowIso_() });
        touch_();
      }
      return getStudentState(sid, '');
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/**
 * 학생 화면 폴링 (4초 간격). token이 서버 갱신토큰과 같으면 changed:false만 반환해
 * 불필요한 전체 로드를 막는다.
 */
function getStudentState(sid, token) {
  try {
    sid = String(sid || '');
    var cur = getToken_();
    if (token && token === cur) return { ok: true, changed: false, token: cur };

    var me = findStudent_(sid);
    if (!me) return err_('입장 정보가 없습니다. 다시 입장해 주세요.');

    var mode = getSetting_('모드');
    var status = getSetting_('상태');
    var partners = (me['짝학번'] || '').split(',').filter(Boolean);

    var allPostits = readAll_('포스트잇').filter(function (p) { return p['숨김'] !== 'Y'; });
    var visible = allPostits.filter(function (p) {
      if (mode !== '짝') return true;
      return p['학번'] === sid || partners.indexOf(p['학번']) !== -1;
    });

    var students = readAll_('학생');
    var nameBy = {};
    students.forEach(function (s) { nameBy[s['학번']] = s['이름']; });

    var partnerList = students
      .filter(function (s) { return s['학번'] !== sid; })
      .filter(function (s) { return mode !== '짝' || partners.indexOf(s['학번']) !== -1; })
      .map(function (s) { return { sid: s['학번'], name: s['이름'] }; });

    var myReflection = readAll_('성찰').filter(function (r) { return r['학번'] === sid; })[0] || null;
    var myMatches = readAll_('매칭기록').filter(function (r) {
      return r['학생A학번'] === sid || r['학생B학번'] === sid;
    }).map(function (r) {
      var other = r['학생A학번'] === sid ? r['학생B학번'] : r['학생A학번'];
      return { id: r.id, otherSid: other, otherName: nameBy[other] || other, note: r['내용'], at: r['기록시각'] };
    });

    return {
      ok: true, changed: true, token: cur,
      status: status, mode: mode,
      me: { sid: sid, name: me['이름'], partners: partners },
      postits: visible.map(function (p) { return postitDto_(p, nameBy); }),
      partnerList: partnerList,
      myMatches: myMatches,
      reflectionDone: !!myReflection,
      spotlightId: getSetting_('스포트라이트') || ''
    };
  } catch (e) { return err_(e.message || String(e)); }
}

function postitDto_(p, nameBy) {
  var withList = (p['매칭상대학번'] || '').split(',').filter(Boolean);
  return {
    id: p.id, sid: p['학번'], name: nameBy[p['학번']] || p['학번'],
    type: p['유형'], content: p['내용'],
    matched: p['매칭여부'] === 'Y', matchedWith: p['매칭상대학번'] || '',
    matchCount: withList.length,
    at: p['작성시각']
  };
}

/** 포스트잇 작성 (작성/시장 단계에서만) */
function addPostit(sid, type, content) {
  try {
    sid = String(sid || ''); type = String(type || ''); content = String(content || '').trim();
    if (!findStudent_(sid)) return err_('입장 정보가 없습니다.');
    var status = getSetting_('상태');
    if (status !== '작성' && status !== '시장') return err_('지금은 포스트잇을 작성할 수 없는 단계예요.');
    if (type !== '초록' && type !== '노랑') return err_('포스트잇 종류가 잘못되었습니다.');
    if (!content) return err_('내용을 입력해 주세요.');
    if (content.length > 80) return err_('80자 이내로 짧게 써 주세요.');
    return withLock_(function () {
      appendRow_('포스트잇', {
        id: shortId_(), '학번': sid, '유형': type, '내용': content,
        '매칭여부': '', '매칭상대학번': '', '숨김': '', '작성시각': nowIso_()
      });
      touch_();
      return { ok: true };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/**
 * 나눔 완료 기록. 한쪽이 기록하면 양쪽 포스트잇 모두 매칭 표시.
 * postitIds: 이번 나눔에 쓰인 포스트잇 id 목록 (내 것/상대 것 섞여도 됨)
 */
function recordShare(sid, partnerSid, postitIds, note) {
  try {
    sid = String(sid || ''); partnerSid = String(partnerSid || '').trim();
    note = String(note || '').trim();
    postitIds = (postitIds || []).map(String);
    if (!findStudent_(sid)) return err_('입장 정보가 없습니다.');
    if (!findStudent_(partnerSid)) return err_('상대 학생을 찾을 수 없습니다.');
    if (sid === partnerSid) return err_('자기 자신과는 나눔을 기록할 수 없어요.');
    if (getSetting_('상태') !== '시장') return err_('시장이 열려 있을 때만 기록할 수 있어요.');
    if (!postitIds.length) return err_('나눔에 쓰인 포스트잇을 1개 이상 선택해 주세요.');

    return withLock_(function () {
      var contents = [];
      for (var i = 0; i < postitIds.length; i++) {
        var p = findPostit_(postitIds[i]);
        if (!p) return err_('포스트잇을 찾을 수 없습니다.');
        if (p['학번'] !== sid && p['학번'] !== partnerSid) return err_('두 사람의 포스트잇만 선택할 수 있어요.');
        // 한 포스트잇이 여러 명과 반복 나눔될 수 있다 — 상대 학번을 누적
        var other = p['학번'] === sid ? partnerSid : sid;
        var withList = (p['매칭상대학번'] || '').split(',').filter(Boolean);
        if (withList.indexOf(other) === -1) withList.push(other);
        p['매칭여부'] = 'Y';
        p['매칭상대학번'] = withList.join(',');
        updateRow_('포스트잇', p._row, p);
        contents.push(p['내용']);
      }
      appendRow_('매칭기록', {
        id: shortId_(), '학생A학번': sid, '학생B학번': partnerSid,
        '내용': note || contents.join(' / '), '기록시각': nowIso_()
      });
      // 스포트라이트 대상이 매칭됐으면 자동 해제
      var spot = getSetting_('스포트라이트');
      if (spot && postitIds.indexOf(spot) !== -1) setSetting_('스포트라이트', '');
      touch_();
      return { ok: true };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/** 성찰 제출 (성찰 단계에서만, 재제출 시 덮어쓰기) */
function submitReflection(sid, giveFeel, receiveFeel) {
  try {
    sid = String(sid || '');
    giveFeel = String(giveFeel || '').trim(); receiveFeel = String(receiveFeel || '').trim();
    if (!findStudent_(sid)) return err_('입장 정보가 없습니다.');
    if (getSetting_('상태') !== '성찰') return err_('아직 성찰 단계가 아니에요.');
    if (!giveFeel || !receiveFeel) return err_('두 질문 모두 한 줄 이상 써 주세요.');
    return withLock_(function () {
      var existing = readAll_('성찰').filter(function (r) { return r['학번'] === sid; })[0];
      var row = { '학번': sid, '줄때마음': giveFeel, '받을때마음': receiveFeel, '작성시각': nowIso_() };
      if (existing) updateRow_('성찰', existing._row, row);
      else appendRow_('성찰', row);
      touch_();
      return { ok: true };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

// ==================== 전광판 (읽기 전용) ====================

function getBoardState(token) {
  try {
    var cur = getToken_();
    if (token && token === cur) return { ok: true, changed: false, token: cur };

    var nameBy = {};
    readAll_('학생').forEach(function (s) { nameBy[s['학번']] = s['이름']; });
    var postits = readAll_('포스트잇').filter(function (p) { return p['숨김'] !== 'Y'; });
    var matched = postits.filter(function (p) { return p['매칭여부'] === 'Y'; });

    return {
      ok: true, changed: true, token: cur,
      status: getSetting_('상태'), mode: getSetting_('모드'),
      postits: postits.map(function (p) { return postitDto_(p, nameBy); }),
      spotlightId: getSetting_('스포트라이트') || '',
      counts: { total: postits.length, matched: matched.length, students: readAll_('학생').length }
    };
  } catch (e) { return err_(e.message || String(e)); }
}

// ==================== 교사 ====================

function requireTeacher_(key) {
  if (String(key || '') !== getSetting_('교사코드')) throw new Error('교사 코드가 올바르지 않습니다. 설정 시트에서 확인하세요.');
}

function teacherLogin(key) {
  try {
    requireTeacher_(key);
    return { ok: true, classCode: getSetting_('반코드') };
  } catch (e) { return err_(e.message || String(e)); }
}

function getTeacherState(key, token) {
  try {
    requireTeacher_(key);
    var cur = getToken_();
    if (token && token === cur) return { ok: true, changed: false, token: cur };

    var students = readAll_('학생');
    var nameBy = {};
    students.forEach(function (s) { nameBy[s['학번']] = s['이름']; });
    var postits = readAll_('포스트잇');
    var visible = postits.filter(function (p) { return p['숨김'] !== 'Y'; });
    var reflections = readAll_('성찰');

    return {
      ok: true, changed: true, token: cur,
      status: getSetting_('상태'), mode: getSetting_('모드'),
      classCode: getSetting_('반코드'),
      spotlightId: getSetting_('스포트라이트') || '',
      students: students.map(function (s) {
        return { sid: s['학번'], name: s['이름'], partners: (s['짝학번'] || '').split(',').filter(Boolean) };
      }),
      postits: postits.map(function (p) {
        var dto = postitDto_(p, nameBy);
        dto.hidden = p['숨김'] === 'Y';
        return dto;
      }),
      counts: {
        students: students.length,
        total: visible.length,
        matched: visible.filter(function (p) { return p['매칭여부'] === 'Y'; }).length,
        reflections: reflections.length
      }
    };
  } catch (e) { return err_(e.message || String(e)); }
}

/** 활동 상태 변경: 대기/작성/시장/성찰/종료 */
function teacherSetStatus(key, status) {
  try {
    requireTeacher_(key);
    if (STATUSES.indexOf(status) === -1) return err_('잘못된 상태입니다.');
    return withLock_(function () {
      setSetting_('상태', status);
      touch_();
      return { ok: true, status: status };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/** 모드 변경. 짝 모드로 바꾸면 짝이 없을 때 자동 편성. */
function teacherSetMode(key, mode) {
  try {
    requireTeacher_(key);
    if (MODES.indexOf(mode) === -1) return err_('잘못된 모드입니다.');
    return withLock_(function () {
      setSetting_('모드', mode);
      if (mode === '짝') {
        var hasPairs = readAll_('학생').some(function (s) { return s['짝학번']; });
        if (!hasPairs) shufflePairs_();
      }
      touch_();
      return { ok: true, mode: mode };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/** 짝 다시 뽑기 (무작위 2인, 홀수면 마지막 3인) */
function teacherShufflePairs(key) {
  try {
    requireTeacher_(key);
    return withLock_(function () {
      var n = shufflePairs_();
      touch_();
      return { ok: true, groups: n };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

function shufflePairs_() {
  var students = readAll_('학생');
  if (students.length < 2) throw new Error('짝을 만들려면 학생이 2명 이상 입장해야 합니다.');
  var shuffled = students.slice();
  for (var i = shuffled.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
  }
  var groups = [];
  var idx = 0;
  while (idx < shuffled.length) {
    var remain = shuffled.length - idx;
    var size = (remain === 3) ? 3 : 2;
    groups.push(shuffled.slice(idx, idx + size));
    idx += size;
  }
  groups.forEach(function (g) {
    g.forEach(function (s) {
      var others = g.filter(function (o) { return o['학번'] !== s['학번']; })
        .map(function (o) { return o['학번']; });
      s['짝학번'] = others.join(',');
      updateRow_('학생', s._row, s);
    });
  });
  return groups.length;
}

/** 전광판 스포트라이트 지정 ('' = 해제) */
function teacherSpotlight(key, postitId) {
  try {
    requireTeacher_(key);
    postitId = String(postitId || '');
    if (postitId && !findPostit_(postitId)) return err_('포스트잇을 찾을 수 없습니다.');
    return withLock_(function () {
      setSetting_('스포트라이트', postitId);
      touch_();
      return { ok: true };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/** 부적절한 포스트잇 숨김/해제 */
function teacherHidePostit(key, postitId, hidden) {
  try {
    requireTeacher_(key);
    return withLock_(function () {
      var p = findPostit_(String(postitId || ''));
      if (!p) return err_('포스트잇을 찾을 수 없습니다.');
      p['숨김'] = hidden ? 'Y' : '';
      updateRow_('포스트잇', p._row, p);
      if (hidden && getSetting_('스포트라이트') === p.id) setSetting_('스포트라이트', '');
      touch_();
      return { ok: true };
    });
  } catch (e) { return err_(e.message || String(e)); }
}
