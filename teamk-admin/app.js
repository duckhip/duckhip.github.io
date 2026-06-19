(function() {
  'use strict';

  var DEFAULT_SHEET = 'https://docs.google.com/spreadsheets/d/1dTYGLzT5EeYRpKYmzSY8KdIDaFmaDrZnp2Yju8bVnDs/edit';
  var MOBILE_PAGE_URL = 'https://duckhip.github.io/teamk-attendance/';
  var state = { spreadsheetId: '', token: '', games: [], game: null, dirty: false };
  var api = window.TeamKAdminApi;
  var domain = window.TeamKDomain;

  function el(id) { return document.getElementById(id); }
  function extractSheetId(value) {
    var match = String(value || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : String(value || '').trim();
  }
  function request(type, extra) {
    return api.post(Object.assign({
      type: type,
      spreadsheetId: state.spreadsheetId,
      sessionToken: state.token
    }, extra || {})).catch(function(error) {
      if (error.code === 'SESSION_EXPIRED' || error.code === 'UNAUTHORIZED') logout(false);
      throw error;
    });
  }
  function showMessage(text, error) {
    var box = el('message');
    box.textContent = text;
    box.className = 'message' + (error ? ' error' : '');
    box.hidden = false;
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(function() { box.hidden = true; }, 3500);
  }
  function setBusy(button, busy, label) {
    button.disabled = busy;
    if (label) button.textContent = busy ? '처리 중...' : label;
  }
  function markDirty() {
    state.dirty = true;
    el('dirtyState').textContent = '저장하지 않은 변경';
  }
  function markSaved() {
    state.dirty = false;
    el('dirtyState').textContent = '저장된 상태';
  }
  function formatWon(value) { return Number(value || 0).toLocaleString() + '원'; }

  function login(password) {
    state.spreadsheetId = extractSheetId(el('spreadsheetInput').value);
    localStorage.setItem('teamk_admin_spreadsheet', el('spreadsheetInput').value);
    return api.post({ type: 'admin_login', spreadsheetId: state.spreadsheetId, password: password })
      .then(function(data) {
        state.token = data.sessionToken;
        sessionStorage.setItem('teamk_admin_session', JSON.stringify({
          spreadsheetId: state.spreadsheetId,
          token: state.token,
          expiresAt: data.expiresAt
        }));
        el('passwordInput').value = '';
        showAdmin();
        return loadGames();
      });
  }

  function logout(callServer) {
    var promise = callServer && state.token ? request('admin_logout').catch(function() {}) : Promise.resolve();
    return promise.finally(function() {
      state.token = '';
      state.game = null;
      sessionStorage.removeItem('teamk_admin_session');
      el('adminView').hidden = true;
      el('logoutButton').hidden = true;
      el('loginView').hidden = false;
    });
  }
  function showAdmin() {
    el('loginView').hidden = true;
    el('adminView').hidden = false;
    el('logoutButton').hidden = false;
  }
  function loadGames(preferredDate) {
    return request('admin_list_games').then(function(data) {
      state.games = data.games || [];
      var select = el('gameDateSelect');
      select.innerHTML = '';
      state.games.forEach(function(game) {
        var option = document.createElement('option');
        option.value = game.date;
        option.textContent = game.date + ' · ' + (game.field || '필드 미정') + ' · ' + game.attendeeCount + '명';
        select.appendChild(option);
      });
      var date = preferredDate || (state.games[0] && state.games[0].date);
      if (date) {
        select.value = date;
        return loadGame(date);
      }
      return newGame();
    });
  }
  function loadGame(date) {
    if (state.dirty && !confirm('저장하지 않은 변경을 버리고 이동하시겠습니까?')) return Promise.resolve();
    return request('admin_get_game', { date: date }).then(function(data) {
      state.game = data;
      renderGame();
      markSaved();
    });
  }
  function newGame() {
    var date = prompt('새 게임일자를 입력하세요.', new Date().toISOString().slice(0, 10));
    if (!date) return;
    state.game = {
      gameInfo: { date: date, field: '', fee: '', account: '', locked: false },
      attendees: [],
      revision: 0,
      qr: { effectiveStatus: 'missing', pendingCount: 0 }
    };
    renderGame();
    markDirty();
  }
  function renderGame() {
    var game = state.game;
    el('gameDate').value = game.gameInfo.date || '';
    el('gameField').value = game.gameInfo.field || '';
    el('gameFee').value = game.gameInfo.fee || '';
    el('gameAccount').value = game.gameInfo.account || '';
    el('revisionBadge').textContent = 'rev ' + (game.revision || 0);
    renderAttendees();
    renderSummary();
    renderQr();
  }
  function syncForm() {
    state.game.gameInfo = {
      date: el('gameDate').value,
      field: el('gameField').value.trim(),
      fee: el('gameFee').value,
      account: el('gameAccount').value.trim(),
      locked: true
    };
  }
  function renderSummary() {
    syncForm();
    var summary = domain.calculateSummary(state.game.gameInfo, state.game.attendees);
    el('totalCount').textContent = summary.totalCount;
    el('paidCount').textContent = summary.paidCount;
    el('gameFeeTotal').textContent = formatWon(summary.gameFeeTotal);
    el('fieldPaymentTotal').textContent = formatWon(summary.fieldPaymentTotal);
  }
  function renderAttendees() {
    var query = domain.normalizeName(el('attendeeSearch').value);
    var list = el('attendeeList');
    list.innerHTML = '';
    state.game.attendees.filter(function(item) {
      return !query || domain.normalizeName(item.name).indexOf(query) >= 0;
    }).forEach(function(item) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'attendee';
      row.innerHTML = '<div><strong></strong><span></span></div><b>편집</b>';
      row.querySelector('strong').textContent = item.name;
      row.querySelector('span').textContent = (item.paid ? '입금완료' : '미입금') + (item.minor ? ' · 소인' : '') + (item.note ? ' · ' + item.note : '');
      row.addEventListener('click', function() { openAttendee(item); });
      list.appendChild(row);
    });
    el('attendeeCount').textContent = state.game.attendees.length + '명';
  }
  function openAttendee(item) {
    item = item || {};
    el('attendeeDialogTitle').textContent = item.id ? '출석자 수정' : '출석자 추가';
    el('attendeeId').value = item.id || '';
    el('attendeeName').value = item.name || '';
    el('attendeePaid').checked = Boolean(item.paid);
    el('attendeeMinor').checked = Boolean(item.minor);
    el('attendeeNote').value = item.note || '';
    el('deleteAttendeeButton').hidden = !item.id;
    el('attendeeDialog').showModal();
  }
  function saveAttendee() {
    var id = el('attendeeId').value;
    var name = el('attendeeName').value.trim();
    if (!name) return;
    var duplicate = state.game.attendees.some(function(item) {
      return item.id !== id && domain.normalizeName(item.name) === domain.normalizeName(name);
    });
    if (duplicate) {
      showMessage('같은 이름이 이미 있습니다.', true);
      return;
    }
    var attendee = domain.createAttendee({
      id: id,
      name: name,
      paid: el('attendeePaid').checked,
      minor: el('attendeeMinor').checked,
      note: el('attendeeNote').value
    });
    if (id) {
      state.game.attendees = state.game.attendees.map(function(item) { return item.id === id ? attendee : item; });
    } else {
      state.game.attendees.push(attendee);
    }
    el('attendeeDialog').close();
    renderAttendees();
    renderSummary();
    markDirty();
  }
  function deleteAttendee() {
    var id = el('attendeeId').value;
    if (!id || !confirm('이 출석자를 삭제하시겠습니까?')) return;
    state.game.attendees = state.game.attendees.filter(function(item) { return item.id !== id; });
    el('attendeeDialog').close();
    renderAttendees();
    renderSummary();
    markDirty();
  }
  function saveGame() {
    syncForm();
    if (!state.game.gameInfo.date || !state.game.gameInfo.field || !state.game.gameInfo.fee) {
      showMessage('게임일자, 필드명, 게임비를 입력해주세요.', true);
      return Promise.resolve(false);
    }
    setBusy(el('saveButton'), true, '서버 저장');
    return request('admin_save_game', {
      date: state.game.gameInfo.date,
      expectedRevision: state.game.revision || 0,
      gameInfo: state.game.gameInfo,
      attendees: state.game.attendees
    }).then(function(data) {
      state.game = data;
      renderGame();
      markSaved();
      showMessage('서버에 저장했습니다.');
      loadGames(state.game.gameInfo.date);
      return true;
    }).catch(function(error) {
      if (error.code === 'REVISION_CONFLICT' && error.data) {
        state.game = error.data;
        renderGame();
        markSaved();
        showMessage('다른 기기의 최신 내용을 불러왔습니다. 변경 내용을 다시 확인해주세요.', true);
      } else {
        showMessage(error.message, true);
      }
      return false;
    }).finally(function() { setBusy(el('saveButton'), false, '서버 저장'); });
  }
  function qrPayload(open, renew) {
    var token = renew || !(state.game.qr && state.game.qr.token)
      ? (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())
      : state.game.qr.token;
    return {
      token: token,
      open: open,
      resetPrinted: Boolean(renew),
      mobilePageUrl: MOBILE_PAGE_URL,
      gameInfo: state.game.gameInfo
    };
  }
  function configureQr(open, renew) {
    syncForm();
    var payload = qrPayload(open, renew);
    return request('configure_mobile_attendance', payload).then(function(result) {
      state.game.qr = Object.assign({}, state.game.qr, result, { token: result.token || payload.token });
      return loadGame(state.game.gameInfo.date);
    }).then(function() { showMessage(open ? 'QR 접수를 시작했습니다.' : 'QR 접수를 마감했습니다.'); })
      .catch(function(error) { showMessage(error.message, true); });
  }
  function renderQr() {
    var qr = state.game.qr || {};
    el('qrStatus').textContent = qr.effectiveStatus === 'open' ? '접수 중' : qr.effectiveStatus === 'closed' ? '마감' : '미설정';
    el('pendingCount').textContent = Number(qr.pendingCount || 0);
    el('qrMeta').textContent = qr.printedAt ? 'QR 출력: ' + new Date(qr.printedAt).toLocaleString() : '미반영 등록 ' + Number(qr.pendingCount || 0) + '건';
  }
  function copyQr() {
    var token = state.game.qr && state.game.qr.token;
    if (!token) return showMessage('먼저 QR 접수를 시작해주세요.', true);
    var url = MOBILE_PAGE_URL + '?spreadsheetId=' + encodeURIComponent(state.spreadsheetId)
      + '&date=' + encodeURIComponent(state.game.gameInfo.date) + '&token=' + encodeURIComponent(token);
    navigator.clipboard.writeText(url).then(function() { showMessage('QR 주소를 복사했습니다.'); });
  }
  function importPending() {
    return request('admin_get_pending_mobile_attendance', { date: state.game.gameInfo.date }).then(function(data) {
      var merged = domain.mergeSubmissions(state.game.attendees, data.submissions || []);
      if (!merged.submissionIds.length) {
        showMessage(merged.skipped ? '이미 등록된 이름만 있어 반영하지 않았습니다.' : '새 등록이 없습니다.');
        return;
      }
      state.game.attendees = merged.attendees;
      markDirty();
      return saveGame().then(function(saved) {
        if (!saved) return;
        return request('ack_mobile_attendance', {
          date: state.game.gameInfo.date,
          submissionIds: merged.submissionIds
        }).then(function() {
          showMessage('모바일 등록 ' + merged.submissionIds.length + '건을 반영했습니다.');
          return loadGame(state.game.gameInfo.date);
        });
      });
    }).catch(function(error) { showMessage(error.message, true); });
  }

  el('loginForm').addEventListener('submit', function(event) {
    event.preventDefault();
    var button = event.submitter;
    setBusy(button, true, '로그인');
    login(el('passwordInput').value).catch(function(error) {
      showMessage(error.message, true);
    }).finally(function() { setBusy(button, false, '로그인'); });
  });
  el('logoutButton').addEventListener('click', function() { logout(true); });
  el('gameDateSelect').addEventListener('change', function() { loadGame(this.value); });
  el('newGameButton').addEventListener('click', newGame);
  el('refreshButton').addEventListener('click', function() { loadGame(state.game.gameInfo.date); });
  ['gameDate','gameField','gameFee','gameAccount'].forEach(function(id) {
    el(id).addEventListener('input', function() { markDirty(); renderSummary(); });
  });
  el('attendeeSearch').addEventListener('input', renderAttendees);
  el('addAttendeeButton').addEventListener('click', function() { openAttendee(); });
  el('attendeeForm').addEventListener('submit', function(event) { event.preventDefault(); saveAttendee(); });
  el('deleteAttendeeButton').addEventListener('click', deleteAttendee);
  document.querySelector('[data-close-dialog]').addEventListener('click', function() { el('attendeeDialog').close(); });
  el('saveButton').addEventListener('click', saveGame);
  el('startQrButton').addEventListener('click', function() { configureQr(true, false); });
  el('renewQrButton').addEventListener('click', function() {
    if (confirm('기존 QR이 무효화됩니다. 새 QR을 발급하시겠습니까?')) configureQr(true, true);
  });
  el('closeQrButton').addEventListener('click', function() { configureQr(false, false); });
  el('copyQrButton').addEventListener('click', copyQr);
  el('importPendingButton').addEventListener('click', importPending);
  window.addEventListener('beforeunload', function(event) {
    if (state.dirty) { event.preventDefault(); event.returnValue = ''; }
  });

  el('spreadsheetInput').value = localStorage.getItem('teamk_admin_spreadsheet') || DEFAULT_SHEET;
  try {
    var saved = JSON.parse(sessionStorage.getItem('teamk_admin_session') || 'null');
    if (saved && saved.token && new Date(saved.expiresAt).getTime() > Date.now()) {
      state.spreadsheetId = saved.spreadsheetId;
      state.token = saved.token;
      showAdmin();
      loadGames().catch(function(error) { showMessage(error.message, true); });
    }
  } catch (error) {
    sessionStorage.removeItem('teamk_admin_session');
  }
})();
