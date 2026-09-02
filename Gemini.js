/**
 * 도움 벼룩시장 — Gemini 응원 메시지 (서버사이드 UrlFetchApp 전용)
 * API 키는 Script Properties(GEMINI_API_KEY)에만 저장. 클라이언트 노출 금지.
 * 성찰 제출 1회당 호출 1회. 결과는 성찰 시트에 캐시해 재호출하지 않는다.
 */

var ENCOURAGE_SYSTEM_PROMPT =
  '당신은 학생들의 나눔 활동을 지켜본 따뜻한 담임 선생님입니다.\n' +
  '학생이 "도움 벼룩시장" 활동에서 실제로 주고받은 도움 목록과, 성찰 질문 2개에 대한 답변이 주어집니다.\n' +
  '이를 바탕으로 그 학생에게 보낼 응원 메시지를 작성하세요.\n' +
  '\n' +
  '[규칙]\n' +
  '- 2~3문장, 존댓말, 따뜻한 목소리로 쓰세요.\n' +
  '- 학생이 준 도움과 받은 도움을 각각 한 번씩은 구체적으로 언급하세요 (내용을 그대로 인용하듯 자연스럽게 녹여서).\n' +
  '- 성찰 답변에서 학생이 표현한 감정을 존중하고 이어받아 언급하세요.\n' +
  '- 다른 학생과 비교하거나 순위를 매기지 마세요. 막연한 칭찬("정말 착하네요")만 쓰지 말고 그 학생의 구체적 행동에 집중하세요.\n' +
  '- 준 도움이나 받은 도움이 없다면 그 사실을 어색하게 짚지 말고, 성찰 답변 중심으로 자연스럽게 쓰세요.\n' +
  '- 출력은 메시지 본문 텍스트만. 따옴표·마크다운·제목·이모지 없이.';

function callGemini_(systemText, userText) {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('Gemini API 키가 설정되지 않았습니다. 선생님께 알려 주세요.');
  var model = getSetting_('gemini_model') || 'gemini-3.5-flash-lite';
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key;

  var payload = {
    system_instruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
  };
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    Logger.log('Gemini 오류 ' + code + ': ' + res.getContentText());
    throw new Error('응원 메시지 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  }
  var data = JSON.parse(res.getContentText());
  try {
    var text = data.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('').trim();
    if (!text) throw new Error('empty');
    return text;
  } catch (e) {
    throw new Error('AI 응답 형식을 해석할 수 없습니다.');
  }
}

/** 학생이 주고받은 도움 + 성찰 답변을 프롬프트용 텍스트로 조립 */
function buildEncourageInput_(given, received, giveFeel, receiveFeel) {
  var lines = [];
  lines.push('[내가 준 도움]');
  lines.push(given.length ? given.map(function (c) { return '- ' + c; }).join('\n') : '(없음)');
  lines.push('');
  lines.push('[내가 받은 도움]');
  lines.push(received.length ? received.map(function (c) { return '- ' + c; }).join('\n') : '(없음)');
  lines.push('');
  lines.push('[도움을 줄 때 어떤 마음이었나요?] ' + giveFeel);
  lines.push('[도움을 받을 때 어떤 마음이었나요?] ' + receiveFeel);
  return lines.join('\n');
}

/** 실패 시 1회 재시도 */
function generateEncouragement_(given, received, giveFeel, receiveFeel) {
  var input = buildEncourageInput_(given, received, giveFeel, receiveFeel);
  var lastErr = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      return callGemini_(ENCOURAGE_SYSTEM_PROMPT, input);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
