(function() {
  'use strict';

  var DEFAULT_SHEET = 'https://docs.google.com/spreadsheets/d/1dTYGLzT5EeYRpKYmzSY8KdIDaFmaDrZnp2Yju8bVnDs/edit';
  var DEFAULT_ACCOUNT = '카카오뱅크 / 3333-25-5603211 / 한성준 (팀케이 모임통장)';
  var MOBILE_PAGE_URL = 'https://duckhip.github.io/teamk-attendance/';
  var FIELD_DEFAULT_FEES = {
    '베이스캠프-양주': '25000',
    '그리드알파-양주': '35000'
  };
  var state = { spreadsheetId: '', token: '', games: [], game: null, dirty: false };
  var calendarMonth = new Date();
  var api = window.TeamKAdminApi;
  var domain = window.TeamKDomain;
  var progress = domain.createProgressTracker(function(active, message) {
    if (active) {
      if (message) el('progressMessage').textContent = message;
      el('progressOverlay').hidden = false;
      document.body.setAttribute('aria-busy', 'true');
    } else {
      el('progressOverlay').hidden = true;
      document.body.removeAttribute('aria-busy');
    }
  });

  function el(id) { return document.getElementById(id); }
  function extractSheetId(value) {
    var match = String(value || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : String(value || '').trim();
  }
  function progressLabel(type) {
    var labels = {
      admin_list_games: '게임 목록을 불러오는 중입니다.',
      admin_get_game: '게임 정보를 불러오는 중입니다.',
      admin_save_game: '서버에 저장하는 중입니다.',
      admin_sync_mobile_attendance: '모바일 출석을 반영하는 중입니다.',
      configure_mobile_attendance: 'QR 접수 상태를 변경하는 중입니다.',
      admin_logout: '로그아웃하는 중입니다.'
    };
    return labels[type] || '서버에서 처리 중입니다.';
  }
  function beginProgress(message) {
    progress.begin(message || '서버에서 처리 중입니다.');
  }
  function endProgress() {
    progress.end();
  }
  function request(type, extra) {
    beginProgress(progressLabel(type));
    return api.post(Object.assign({
      type: type,
      spreadsheetId: state.spreadsheetId,
      sessionToken: state.token
    }, extra || {})).catch(function(error) {
      if (error.code === 'SESSION_EXPIRED' || error.code === 'UNAUTHORIZED') logout(false);
      throw error;
    }).finally(endProgress);
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
  function renderGameOptions(selectedDate) {
    var select = el('gameDateSelect');
    var fragment = document.createDocumentFragment();
    state.games.forEach(function(game) {
      var option = document.createElement('option');
      option.value = game.date;
      option.textContent = game.date + ' · ' + (game.field || '필드 미정') + ' · ' + game.attendeeCount + '명';
      fragment.appendChild(option);
    });
    select.replaceChildren(fragment);
    if (selectedDate) select.value = selectedDate;
  }
  function applyGameSnapshot(game) {
    state.game = game;
    renderGame();
    markSaved();
  }
  function updateGameList(game) {
    var item = {
      date: game.gameInfo.date,
      field: game.gameInfo.field,
      attendeeCount: game.attendees.length,
      revision: game.revision || 0
    };
    state.games = state.games.filter(function(existing) {
      return existing.date !== item.date;
    });
    state.games.push(item);
    state.games.sort(function(a, b) { return b.date.localeCompare(a.date); });
    renderGameOptions(item.date);
  }
  function loadGames(preferredDate) {
    return request('admin_list_games', {
      preferredDate: preferredDate || '',
      includeSelectedGame: true
    }).then(function(data) {
      state.games = data.games || [];
      if (data.selectedGame) {
        renderGameOptions(data.selectedGame.gameInfo.date);
        applyGameSnapshot(data.selectedGame);
        return;
      }
      renderGameOptions('');
      return openNewGameCalendar();
    });
  }
  function loadGame(date) {
    if (state.dirty && !confirm('저장하지 않은 변경을 버리고 이동하시겠습니까?')) return Promise.resolve();
    return request('admin_get_game', { date: date }).then(function(data) {
      applyGameSnapshot(data);
    });
  }
  function formatDateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }
  function openNewGameCalendar() {
    if (state.dirty && !confirm('저장하지 않은 변경을 버리고 새 게임을 만드시겠습니까?')) return;
    var today = new Date();
    calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    renderGameDateCalendar();
    el('gameDateDialog').showModal();
  }
  function renderGameDateCalendar() {
    var year = calendarMonth.getFullYear();
    var month = calendarMonth.getMonth();
    var firstDay = new Date(year, month, 1).getDay();
    var lastDate = new Date(year, month + 1, 0).getDate();
    var todayKey = formatDateKey(new Date());
    var gameDates = new Set(state.games.map(function(game) { return game.date; }));
    var fragment = document.createDocumentFragment();
    el('calendarMonthLabel').textContent = year + '년 ' + (month + 1) + '월';
    for (var emptyIndex = 0; emptyIndex < firstDay; emptyIndex += 1) {
      var empty = document.createElement('span');
      empty.className = 'calendar-empty';
      empty.setAttribute('aria-hidden', 'true');
      fragment.appendChild(empty);
    }
    for (var dateNumber = 1; dateNumber <= lastDate; dateNumber += 1) {
      var date = new Date(year, month, dateNumber);
      var dateKey = formatDateKey(date);
      var dayOfWeek = date.getDay();
      var isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      var button = document.createElement('button');
      var number = document.createElement('span');
      button.type = 'button';
      button.className = 'calendar-day ' + (isWeekend ? 'weekend' : 'weekday');
      button.dataset.gameDate = dateKey;
      button.setAttribute('aria-label', dateKey + ' ' + ['일','월','화','수','목','금','토'][dayOfWeek] + '요일');
      button.disabled = gameDates.has(dateKey);
      if (button.disabled) button.setAttribute('aria-label', button.getAttribute('aria-label') + ', 등록된 게임');
      if (dateKey === todayKey) button.classList.add('today');
      number.className = 'calendar-day-number';
      number.textContent = dateNumber;
      button.appendChild(number);
      fragment.appendChild(button);
    }
    el('gameDateCalendar').replaceChildren(fragment);
  }
  function moveCalendarMonth(offset) {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + offset, 1);
    renderGameDateCalendar();
  }
  function renderDraftGameOption(date) {
    var select = el('gameDateSelect');
    var option = document.createElement('option');
    renderGameOptions('');
    option.value = date;
    option.textContent = date + ' · 새 게임';
    select.prepend(option);
    select.value = date;
  }
  function createNewGame(date) {
    state.game = {
      gameInfo: { date: date, field: '', fee: '', account: DEFAULT_ACCOUNT, locked: false },
      attendees: [],
      revision: 0,
      qr: { effectiveStatus: 'missing', pendingCount: 0 }
    };
    el('gameDateDialog').close();
    renderDraftGameOption(date);
    renderGame();
    markDirty();
  }
  function renderGame() {
    var game = state.game;
    el('gameDate').value = game.gameInfo.date || '';
    renderField(game.gameInfo.field || '');
    el('gameFee').value = game.gameInfo.fee || '';
    el('revisionBadge').textContent = 'rev ' + (game.revision || 0);
    el('attendeeSearch').value = '';
    renderAttendees();
    renderSummary();
    renderQr();
  }
  function renderField(field) {
    var fixedFields = ['베이스캠프-양주', '그리드알파-양주'];
    var isFixed = fixedFields.indexOf(field) >= 0;
    var isCustom = Boolean(field) && !isFixed;
    el('gameFieldSelect').value = isFixed ? field : (isCustom ? '직접입력' : '');
    el('gameField').value = isCustom ? field : '';
    el('customFieldLabel').hidden = !isCustom;
  }
  function getSelectedField() {
    return el('gameFieldSelect').value === '직접입력'
      ? el('gameField').value.trim()
      : el('gameFieldSelect').value;
  }
  function handleFieldSelect() {
    var custom = el('gameFieldSelect').value === '직접입력';
    el('customFieldLabel').hidden = !custom;
    if (!custom) el('gameField').value = '';
    if (!custom && FIELD_DEFAULT_FEES[el('gameFieldSelect').value]) {
      el('gameFee').value = FIELD_DEFAULT_FEES[el('gameFieldSelect').value];
    }
    markDirty();
    renderSummary();
    if (custom) el('gameField').focus();
  }
  function syncForm() {
    state.game.gameInfo = {
      date: el('gameDate').value,
      field: getSelectedField(),
      fee: el('gameFee').value,
      account: DEFAULT_ACCOUNT,
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
    var fragment = document.createDocumentFragment();
    state.game.attendees.filter(function(item) {
      return !query || domain.normalizeName(item.name).indexOf(query) >= 0;
    }).forEach(function(item) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'attendee';
      var body = document.createElement('div');
      var name = document.createElement('strong');
      var meta = document.createElement('span');
      var action = document.createElement('b');
      name.textContent = item.name;
      meta.textContent = (item.paid ? '입금완료' : '미입금') + (item.minor ? ' · 소인' : '') + (item.note ? ' · ' + item.note : '');
      action.textContent = '편집';
      body.append(name, meta);
      row.append(body, action);
      row.addEventListener('click', function() { openAttendee(item); });
      fragment.appendChild(row);
    });
    list.replaceChildren(fragment);
    el('attendeeCount').textContent = state.game.attendees.length + '명';
  }
  function openAttendee(item) {
    item = item || {};
    var isEdit = item.id != null && String(item.id) !== '';
    el('attendeeDialogTitle').textContent = isEdit ? '출석자 수정' : '출석자 추가';
    el('attendeeId').value = item.id == null ? '' : String(item.id);
    el('attendeeName').value = item.name || '';
    el('attendeePaid').checked = isEdit ? Boolean(item.paid) : true;
    el('attendeeMinor').checked = Boolean(item.minor);
    el('attendeeMinorText').textContent = isEdit ? '소인' : '소인 추가';
    el('attendeeMinorCount').value = '1';
    updateMinorCountField();
    el('attendeeNote').value = item.note || '';
    el('deleteAttendeeButton').hidden = !isEdit;
    el('attendeeDialog').showModal();
  }
  function saveAttendee() {
    var id = el('attendeeId').value;
    var name = el('attendeeName').value.trim();
    if (!name) return;
    if (domain.hasDuplicateAttendee(state.game.attendees, name, id)) {
      showMessage('같은 이름이 이미 있습니다.', true);
      return;
    }
    var input = {
      id: id,
      name: name,
      paid: el('attendeePaid').checked,
      minor: el('attendeeMinor').checked,
      note: el('attendeeNote').value.trim()
    };
    if (id) {
      state.game.attendees = domain.upsertAttendee(state.game.attendees, input);
      showMessage('출석자 정보를 수정했습니다.');
    } else {
      input.minorCount = input.minor ? el('attendeeMinorCount').value : 0;
      state.game.attendees = domain.addAttendeeGroup(state.game.attendees, input);
      var addedCount = Number(input.minorCount) + 1;
      showMessage('출석자 ' + addedCount + '명을 추가했습니다.');
    }
    el('attendeeDialog').close();
    el('attendeeSearch').value = '';
    renderAttendees();
    renderSummary();
    markDirty();
  }
  function updateMinorCountField() {
    var isEdit = Boolean(el('attendeeId').value);
    el('attendeeMinorCountLabel').hidden = isEdit || !el('attendeeMinor').checked;
  }
  function deleteAttendee() {
    var id = el('attendeeId').value;
    if (!id || !confirm('이 출석자를 삭제하시겠습니까?')) return;
    state.game.attendees = domain.deleteAttendee(state.game.attendees, id);
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
      applyGameSnapshot(data);
      updateGameList(data);
      showMessage('서버에 저장했습니다.');
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
      renderQr();
      showMessage(open ? 'QR 접수를 시작했습니다.' : 'QR 접수를 마감했습니다.');
    })
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
    return request('admin_sync_mobile_attendance', { date: state.game.gameInfo.date }).then(function(data) {
      applyGameSnapshot(data);
      updateGameList(data);
      var merged = data.merged || { added: 0, updated: 0, skipped: 0 };
      var details = [];
      if (merged.added > 0) details.push(merged.added + '명 추가');
      if (merged.updated > 0) details.push(merged.updated + '건 수정');
      if (merged.skipped > 0) details.push(merged.skipped + '건 제외');
      showMessage(details.length ? '모바일 출석 ' + details.join(', ') + '했습니다.' : '새 모바일 출석이 없습니다.');
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
  el('newGameButton').addEventListener('click', openNewGameCalendar);
  el('refreshButton').addEventListener('click', function() { loadGame(state.game.gameInfo.date); });
  el('calendarPreviousMonth').addEventListener('click', function() { moveCalendarMonth(-1); });
  el('calendarNextMonth').addEventListener('click', function() { moveCalendarMonth(1); });
  el('calendarTodayButton').addEventListener('click', function() {
    var today = new Date();
    calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    renderGameDateCalendar();
  });
  el('gameDateCalendar').addEventListener('click', function(event) {
    var button = event.target.closest('[data-game-date]');
    if (button && !button.disabled) createNewGame(button.dataset.gameDate);
  });
  document.querySelector('[data-close-game-date-dialog]').addEventListener('click', function() {
    el('gameDateDialog').close();
  });
  ['gameDate','gameField','gameFee'].forEach(function(id) {
    el(id).addEventListener('input', function() { markDirty(); renderSummary(); });
  });
  el('gameFieldSelect').addEventListener('change', handleFieldSelect);
  el('attendeeSearch').addEventListener('input', renderAttendees);
  el('addAttendeeButton').addEventListener('click', function() { openAttendee(); });
  el('attendeeMinor').addEventListener('change', updateMinorCountField);
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
