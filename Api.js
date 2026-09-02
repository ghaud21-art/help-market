/**
 * 도움 벼룩시장 — 서버 API (google.script.run + doPost JSON 공용)
 * 여러 반이 한 시트를 공유한다: 반마다 반코드·상태·모드·스포트라이트가 독립이고,
 * 학생·포스트잇·매칭기록·성찰은 전부 session_id로 분리된다.
 * 모든 함수는 JSON 직렬화 가능한 객체만 반환, 날짜는 ISO 문자열로만.
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

function sessionDto_(s) {
  return {
    session_id: s.session_id, name: s['반이름'], code: s['반코드'],
    status: s['상태'], mode: s['모드'], created_at: s['생성시각']
  };
}

// ==================== 학생 ====================

/** 입장: 반 코드 + 학번 + 이름. 재접속 시 기존 정보 유지. */
function joinStudent(code, sid, name) {
  try {
    code = String(code || '').trim(); sid = String(sid || '').trim(); name = String(name || '').trim();
    if (!code || !sid || !name) return err_('반 코드, 학번, 이름을 모두 입력해 주세요.');
    var session = findSessionByCode_(code);
    if (!session) return err_('반 코드를 찾을 수 없습니다. 다시 확인해 주세요.');
    return withLock_(function () {
      if (!findStudent_(session.session_id, sid)) {
        appendRow_('학생', { session_id: session.session_id, '학번': sid, '이름': name, '짝학번': '', '입장시각': nowIso_() });
        touch_();
      }
      return getStudentState(session.session_id, sid, '');
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/** 학생 화면 폴링 (4초). token이 갱신토큰과 같으면 changed:false만 반환. */
function getStudentState(sessionId, sid, token) {
  try {
    sessionId = String(sessionId || ''); sid = String(sid || '');
    var cur = getToken_();
    if (token && token === cur) return { ok: true, changed: false, token: cur };

    var session = findSessionById_(sessionId);
    if (!session) return err_('반 정보를 찾을 수 없습니다. 다시 입장해 주세요.');
    var me = findStudent_(sessionId, sid);
    if (!me) return err_('입장 정보가 없습니다. 다시 입장해 주세요.');

    var partners = (me['짝학번'] || '').split(',').filter(Boolean);
    var inSession = function (r) { return r.session_id === sessionId; };

    var allPostits = readAll_('포스트잇').filter(inSession).filter(function (p) { return p['숨김'] !== 'Y'; });
    var visible = allPostits.filter(function (p) {
      if (session['모드'] !== '짝') return true;
      return p['학번'] === sid || partners.indexOf(p['학번']) !== -1;
    });

    var students = readAll_('학생').filter(inSession);
    var nameBy = {};
    students.forEach(function (s) { nameBy[s['학번']] = s['이름']; });

    var partnerList = students
      .filter(function (s) { return s['학번'] !== sid; })
      .filter(function (s) { return session['모드'] !== '짝' || partners.indexOf(s['학번']) !== -1; })
      .map(function (s) { return { sid: s['학번'], name: s['이름'] }; });

    var myReflection = readAll_('성찰').filter(inSession).filter(function (r) { return r['학번'] === sid; })[0] || null;
    var myMatches = readAll_('매칭기록').filter(inSession).filter(function (r) {
      return r['학생A학번'] === sid || r['학생B학번'] === sid;
    }).map(function (r) {
      var other = r['학생A학번'] === sid ? r['학생B학번'] : r['학생A학번'];
      return { id: r.id, otherSid: other, otherName: nameBy[other] || other, note: r['내용'], at: r['기록시각'] };
    });

    return {
      ok: true, changed: true, token: cur,
      session_id: sessionId, session_name: session['반이름'],
      status: session['상태'], mode: session['모드'],
      me: { sid: sid, name: me['이름'], partners: partners },
      postits: visible.map(function (p) { return postitDto_(p, nameBy); }),
      partnerList: partnerList,
      myMatches: myMatches,
      reflectionDone: !!myReflection,
      spotlightId: session['스포트라이트'] || ''
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
function addPostit(sessionId, sid, type, content) {
  try {
    sessionId = String(sessionId || ''); sid = String(sid || '');
    type = String(type || ''); content = String(content || '').trim();
    var session = findSessionById_(sessionId);
    if (!session) return err_('반 정보를 찾을 수 없습니다.');
    if (!findStudent_(sessionId, sid)) return err_('입장 정보가 없습니다.');
    if (session['상태'] !== '작성' && session['상태'] !== '시장') return err_('지금은 포스트잇을 작성할 수 없는 단계예요.');
    if (type !== '초록' && type !== '노랑') return err_('포스트잇 종류가 잘못되었습니다.');
    if (!content) return err_('내용을 입력해 주세요.');
    if (content.length > 80) return err_('80자 이내로 짧게 써 주세요.');
    return withLock_(function () {
      appendRow_('포스트잇', {
        id: shortId_(), session_id: sessionId, '학번': sid, '유형': type, '내용': content,
        '매칭여부': '', '매칭상대학번': '', '숨김': '', '작성시각': nowIso_()
      });
      touch_();
      return { ok: true };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/**
 * 나눔 완료 기록. 한쪽이 기록하면 양쪽 포스트잇 모두 매칭 표시.
 * 한 포스트잇이 여러 명과 반복 나눔될 수 있다 (상대 학번 누적).
 */
function recordShare(sessionId, sid, partnerSid, postitIds, note) {
  try {
    sessionId = String(sessionId || ''); sid = String(sid || '');
    partnerSid = String(partnerSid || '').trim(); note = String(note || '').trim();
    postitIds = (postitIds || []).map(String);
    var session = findSessionById_(sessionId);
    if (!session) return err_('반 정보를 찾을 수 없습니다.');
    if (!findStudent_(sessionId, sid)) return err_('입장 정보가 없습니다.');
    if (!findStudent_(sessionId, partnerSid)) return err_('상대 학생을 찾을 수 없습니다.');
    if (sid === partnerSid) return err_('자기 자신과는 나눔을 기록할 수 없어요.');
    if (session['상태'] !== '시장') return err_('시장이 열려 있을 때만 기록할 수 있어요.');
    if (!postitIds.length) return err_('나눔에 쓰인 포스트잇을 1개 이상 선택해 주세요.');

    return withLock_(function () {
      var contents = [];
      for (var i = 0; i < postitIds.length; i++) {
        var p = findPostit_(postitIds[i]);
        if (!p || p.session_id !== sessionId) return err_('포스트잇을 찾을 수 없습니다.');
        if (p['학번'] !== sid && p['학번'] !== partnerSid) return err_('두 사람의 포스트잇만 선택할 수 있어요.');
        var other = p['학번'] === sid ? partnerSid : sid;
        var withList = (p['매칭상대학번'] || '').split(',').filter(Boolean);
        if (withList.indexOf(other) === -1) withList.push(other);
        p['매칭여부'] = 'Y';
        p['매칭상대학번'] = withList.join(',');
        updateRow_('포스트잇', p._row, p);
        contents.push(p['내용']);
      }
      appendRow_('매칭기록', {
        id: shortId_(), session_id: sessionId, '학생A학번': sid, '학생B학번': partnerSid,
        '내용': note || contents.join(' / '), '기록시각': nowIso_()
      });
      // 스포트라이트 대상이 매칭됐으면 자동 해제
      if (session['스포트라이트'] && postitIds.indexOf(session['스포트라이트']) !== -1) {
        session['스포트라이트'] = '';
        updateRow_('반', session._row, session);
      }
      touch_();
      return { ok: true };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/** 성찰 제출 (성찰 단계에서만, 재제출 시 덮어쓰기) */
function submitReflection(sessionId, sid, giveFeel, receiveFeel) {
  try {
    sessionId = String(sessionId || ''); sid = String(sid || '');
    giveFeel = String(giveFeel || '').trim(); receiveFeel = String(receiveFeel || '').trim();
    var session = findSessionById_(sessionId);
    if (!session) return err_('반 정보를 찾을 수 없습니다.');
    if (!findStudent_(sessionId, sid)) return err_('입장 정보가 없습니다.');
    if (session['상태'] !== '성찰') return err_('아직 성찰 단계가 아니에요.');
    if (!giveFeel || !receiveFeel) return err_('두 질문 모두 한 줄 이상 써 주세요.');
    return withLock_(function () {
      var existing = readAll_('성찰').filter(function (r) {
        return r.session_id === sessionId && r['학번'] === sid;
      })[0];
      var row = {
        session_id: sessionId, '학번': sid, '줄때마음': giveFeel, '받을때마음': receiveFeel,
        '응원메시지': existing ? existing['응원메시지'] : '', '작성시각': nowIso_()
      };
      // 답변 내용을 고치면 예전 응원 메시지는 더 이상 맞지 않으므로 비워서 다음 조회 때 재생성
      if (existing && (existing['줄때마음'] !== giveFeel || existing['받을때마음'] !== receiveFeel)) row['응원메시지'] = '';
      if (existing) updateRow_('성찰', existing._row, row);
      else appendRow_('성찰', row);
      touch_();
      return { ok: true };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/** 학생 본인이 주고받은 도움 요약 — 성찰 카드·AI 프롬프트 공용 */
function givenReceivedSummary_(sessionId, sid) {
  var inSession = function (r) { return r.session_id === sessionId; };
  var nameBy = {};
  readAll_('학생').filter(inSession).forEach(function (s) { nameBy[s['학번']] = s['이름']; });
  var mine = readAll_('포스트잇').filter(inSession).filter(function (p) {
    return p['학번'] === sid && p['매칭여부'] === 'Y';
  });
  var given = [], received = [];
  mine.forEach(function (p) {
    var withList = (p['매칭상대학번'] || '').split(',').filter(Boolean);
    var item = {
      content: p['내용'], count: withList.length,
      partners: withList.map(function (x) { return nameBy[x] || x; })
    };
    (p['유형'] === '초록' ? given : received).push(item);
  });
  return { given: given, received: received };
}

/**
 * 성찰 완료 카드 조회/생성. 이미 생성된 응원 메시지가 있으면 그대로 반환(재호출 없음).
 * AI 실패 시 클라이언트가 [다시 시도]로 이 함수만 재호출 — 성찰 답변은 이미 저장돼 있으므로
 * 응원 메시지 생성만 재시도한다 (성찰 재제출 불필요).
 */
function generateReflectionCard(sessionId, sid) {
  try {
    sessionId = String(sessionId || ''); sid = String(sid || '');
    var session = findSessionById_(sessionId);
    if (!session) return err_('반 정보를 찾을 수 없습니다.');
    var student = findStudent_(sessionId, sid);
    if (!student) return err_('입장 정보가 없습니다.');
    var reflection = readAll_('성찰').filter(function (r) {
      return r.session_id === sessionId && r['학번'] === sid;
    })[0];
    if (!reflection) return err_('아직 성찰을 제출하지 않았습니다.');

    var summary = givenReceivedSummary_(sessionId, sid);
    var card = {
      session_name: session['반이름'], sid: sid, name: student['이름'],
      given: summary.given, received: summary.received,
      giveFeel: reflection['줄때마음'], receiveFeel: reflection['받을때마음'],
      encouragement: reflection['응원메시지'] || ''
    };
    if (card.encouragement) return { ok: true, card: card };

    // Gemini 호출은 락 밖에서 (다른 학생의 동시 요청을 막지 않기 위해)
    var text = generateEncouragement_(
      summary.given.map(function (g) { return g.content + (g.count > 1 ? ' (' + g.count + '명과 나눔)' : ''); }),
      summary.received.map(function (r) { return r.content; }),
      reflection['줄때마음'], reflection['받을때마음']
    );

    return withLock_(function () {
      var again = readAll_('성찰').filter(function (r) {
        return r.session_id === sessionId && r['학번'] === sid;
      })[0];
      if (!again) return err_('성찰 기록을 찾을 수 없습니다.');
      if (!again['응원메시지']) {
        again['응원메시지'] = text;
        updateRow_('성찰', again._row, again);
      }
      card.encouragement = again['응원메시지'] || text;
      return { ok: true, card: card };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

// ==================== 전광판 (읽기 전용, 반코드로 접근) ====================

function getBoardState(code, token) {
  try {
    var session = findSessionByCode_(String(code || ''));
    if (!session) return err_('반 코드를 찾을 수 없습니다.');
    var cur = getToken_();
    if (token && token === cur) return { ok: true, changed: false, token: cur };

    var sessionId = session.session_id;
    var inSession = function (r) { return r.session_id === sessionId; };
    var nameBy = {};
    var students = readAll_('학생').filter(inSession);
    students.forEach(function (s) { nameBy[s['학번']] = s['이름']; });
    var postits = readAll_('포스트잇').filter(inSession).filter(function (p) { return p['숨김'] !== 'Y'; });
    var matched = postits.filter(function (p) { return p['매칭여부'] === 'Y'; });
    var shares = readAll_('매칭기록').filter(inSession).length;

    return {
      ok: true, changed: true, token: cur,
      session_name: session['반이름'],
      status: session['상태'], mode: session['모드'],
      postits: postits.map(function (p) { return postitDto_(p, nameBy); }),
      spotlightId: session['스포트라이트'] || '',
      counts: { total: postits.length, matched: matched.length, students: students.length, shares: shares }
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
    return { ok: true, sessions: readAll_('반').map(sessionDto_) };
  } catch (e) { return err_(e.message || String(e)); }
}

/** 새 반 만들기 → 반코드 발급 */
function teacherCreateSession(key, name) {
  try {
    requireTeacher_(key);
    name = String(name || '').trim();
    if (!name) return err_('반 이름을 입력해 주세요. (예: 2-3반 4교시)');
    return withLock_(function () {
      var session = {
        session_id: shortId_(), '반이름': name, '반코드': generateCode_(),
        '상태': '대기', '모드': '자유', '스포트라이트': '', '생성시각': nowIso_()
      };
      appendRow_('반', session);
      touch_();
      return { ok: true, session: sessionDto_(session) };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/** 반 삭제 (그 반의 학생·포스트잇·기록·성찰까지 함께) */
function teacherDeleteSession(key, sessionId) {
  try {
    requireTeacher_(key);
    sessionId = String(sessionId || '');
    return withLock_(function () {
      var session = findSessionById_(sessionId);
      if (!session) return err_('반을 찾을 수 없습니다.');
      deleteRowsWhere_('반', function (r) { return r.session_id === sessionId; });
      var inSession = function (r) { return r.session_id === sessionId; };
      deleteRowsWhere_('학생', inSession);
      deleteRowsWhere_('포스트잇', inSession);
      deleteRowsWhere_('매칭기록', inSession);
      deleteRowsWhere_('성찰', inSession);
      touch_();
      return { ok: true };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

function getTeacherState(key, sessionId, token) {
  try {
    requireTeacher_(key);
    var cur = getToken_();
    if (token && token === cur) return { ok: true, changed: false, token: cur };

    sessionId = String(sessionId || '');
    var session = findSessionById_(sessionId);
    var sessions = readAll_('반').map(sessionDto_);
    if (!session) return { ok: true, changed: true, token: cur, sessions: sessions, session: null };

    var inSession = function (r) { return r.session_id === sessionId; };
    var students = readAll_('학생').filter(inSession);
    var nameBy = {};
    students.forEach(function (s) { nameBy[s['학번']] = s['이름']; });
    var postits = readAll_('포스트잇').filter(inSession);
    var visible = postits.filter(function (p) { return p['숨김'] !== 'Y'; });
    var reflections = readAll_('성찰').filter(inSession);

    return {
      ok: true, changed: true, token: cur,
      sessions: sessions,
      session: sessionDto_(session),
      spotlightId: session['스포트라이트'] || '',
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

/** 활동 상태 변경: 대기/작성/시장/성찰/종료 (선택한 반에만 적용) */
function teacherSetStatus(key, sessionId, status) {
  try {
    requireTeacher_(key);
    if (STATUSES.indexOf(status) === -1) return err_('잘못된 상태입니다.');
    return withLock_(function () {
      var session = findSessionById_(String(sessionId || ''));
      if (!session) return err_('반을 찾을 수 없습니다.');
      session['상태'] = status;
      updateRow_('반', session._row, session);
      touch_();
      return { ok: true, status: status };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/** 모드 변경. 짝 모드로 바꾸면 짝이 없을 때 자동 편성. */
function teacherSetMode(key, sessionId, mode) {
  try {
    requireTeacher_(key);
    if (MODES.indexOf(mode) === -1) return err_('잘못된 모드입니다.');
    return withLock_(function () {
      var session = findSessionById_(String(sessionId || ''));
      if (!session) return err_('반을 찾을 수 없습니다.');
      session['모드'] = mode;
      updateRow_('반', session._row, session);
      if (mode === '짝') {
        var hasPairs = readAll_('학생').some(function (s) {
          return s.session_id === session.session_id && s['짝학번'];
        });
        if (!hasPairs) shufflePairs_(session.session_id);
      }
      touch_();
      return { ok: true, mode: mode };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

/** 짝 다시 뽑기 (무작위 2인, 홀수면 마지막 3인) */
function teacherShufflePairs(key, sessionId) {
  try {
    requireTeacher_(key);
    return withLock_(function () {
      var n = shufflePairs_(String(sessionId || ''));
      touch_();
      return { ok: true, groups: n };
    });
  } catch (e) { return err_(e.message || String(e)); }
}

function shufflePairs_(sessionId) {
  var students = readAll_('학생').filter(function (s) { return s.session_id === sessionId; });
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
function teacherSpotlight(key, sessionId, postitId) {
  try {
    requireTeacher_(key);
    postitId = String(postitId || '');
    return withLock_(function () {
      var session = findSessionById_(String(sessionId || ''));
      if (!session) return err_('반을 찾을 수 없습니다.');
      if (postitId) {
        var p = findPostit_(postitId);
        if (!p || p.session_id !== session.session_id) return err_('포스트잇을 찾을 수 없습니다.');
      }
      session['스포트라이트'] = postitId;
      updateRow_('반', session._row, session);
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
      if (hidden) {
        var session = findSessionById_(p.session_id);
        if (session && session['스포트라이트'] === p.id) {
          session['스포트라이트'] = '';
          updateRow_('반', session._row, session);
        }
      }
      touch_();
      return { ok: true };
    });
  } catch (e) { return err_(e.message || String(e)); }
}
