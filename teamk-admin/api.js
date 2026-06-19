(function(global) {
  'use strict';

  var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzPgkd98ZVALSGfY5Z9Q0KbRx1gyo2etlioTR6fpFKmyzO6JbFwQh626L4gCHqtaRxt/exec';

  function readJson(response) {
    if (!response.ok) throw new Error('서버 응답 오류 (' + response.status + ')');
    return response.text().then(function(text) {
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error('서버 응답을 확인할 수 없습니다.');
      }
    });
  }

  function post(payload) {
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(readJson).then(function(result) {
      if (!result.success) {
        var error = new Error(result.error || '요청에 실패했습니다.');
        error.code = result.errorCode || 'SERVER_ERROR';
        error.data = result.data || null;
        throw error;
      }
      return result.data || result;
    });
  }

  global.TeamKAdminApi = { post: post, url: APPS_SCRIPT_URL };
})(window);
