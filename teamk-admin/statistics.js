(function() {
  'use strict';

  var api = window.TeamKAdminApi;
  var domain = window.TeamKDomain;
  var state = { spreadsheetId: '', token: '', games: [] };

  function el(id) { return document.getElementById(id); }

  function init() {
    el('backButton').addEventListener('click', function() {
      window.location.href = 'index.html';
    });

    try {
      var saved = JSON.parse(sessionStorage.getItem('teamk_admin_session') || 'null');
      if (saved && saved.token && new Date(saved.expiresAt).getTime() > Date.now()) {
        state.spreadsheetId = saved.spreadsheetId;
        state.token = saved.token;
        loadStatistics();
      } else {
        alert('로그인이 만료되었습니다. 다시 로그인해주세요.');
        window.location.href = 'index.html';
      }
    } catch (error) {
      window.location.href = 'index.html';
    }
  }

  function loadStatistics() {
    api.post({
      type: 'admin_get_all_games',
      spreadsheetId: state.spreadsheetId,
      sessionToken: state.token
    }).then(function(data) {
      if (data && data.games) {
        state.games = data.games;
        renderStatistics();
        el('loadingMessage').hidden = true;
        el('statsContent').hidden = false;
      }
    }).catch(function(error) {
      alert('통계 데이터를 불러오는데 실패했습니다: ' + error.message);
      el('loadingMessage').textContent = '데이터 로드 실패';
    });
  }

  function renderStatistics() {
    var games = state.games.filter(function(g) { return g.attendees && g.attendees.length > 0; });
    var totalGames = games.length;
    var totalAttendees = 0;
    var fieldCount = {};
    var monthCount = {};
    var rankingMap = {};

    games.forEach(function(g) {
      var attendees = g.attendees || [];
      totalAttendees += attendees.length;

      // 필드 집계
      var field = g.gameInfo.field || '미지정';
      fieldCount[field] = (fieldCount[field] || 0) + attendees.length;

      // 월별 집계 (YYYY-MM)
      var month = g.gameInfo.date.substring(0, 7);
      monthCount[month] = (monthCount[month] || 0) + attendees.length;

      // 개인별 집계
      attendees.forEach(function(a) {
        var name = domain.normalizeName(a.name);
        if (!rankingMap[name]) rankingMap[name] = { name: a.name, count: 0 };
        rankingMap[name].count++;
      });
    });

    var avgAttendees = totalGames > 0 ? (totalAttendees / totalGames).toFixed(1) : 0;

    el('totalGames').textContent = totalGames + '회';
    el('totalAttendees').textContent = totalAttendees + '명';
    el('avgAttendees').textContent = avgAttendees + '명';

    renderRanking(rankingMap);
    renderMonthlyChart(monthCount);
    renderFieldChart(fieldCount);
  }

  function renderRanking(rankingMap) {
    var list = Object.values(rankingMap).sort(function(a, b) {
      return b.count - a.count || a.name.localeCompare(b.name);
    }).slice(0, 10);

    var container = el('rankingList');
    container.innerHTML = '';
    list.forEach(function(item, idx) {
      var row = document.createElement('div');
      row.className = 'ranking-item';

      var rank = document.createElement('span');
      rank.className = 'ranking-rank';
      rank.textContent = (idx + 1);

      var name = document.createElement('strong');
      name.textContent = item.name;

      var count = document.createElement('span');
      count.className = 'ranking-count';
      count.textContent = item.count + '회';

      row.append(rank, name, count);
      container.appendChild(row);
    });
  }

  function renderMonthlyChart(monthCount) {
    var ctx = el('monthlyChart').getContext('2d');
    var keys = Object.keys(monthCount).sort();
    var values = keys.map(function(k) { return monthCount[k]; });

    new Chart(ctx, {
      type: 'line',
      data: {
        labels: keys,
        datasets: [{
          label: '월별 출석자수',
          data: values,
          borderColor: '#1685c5',
          backgroundColor: 'rgba(22, 133, 197, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 5 } } }
      }
    });
  }

  function renderFieldChart(fieldCount) {
    var ctx = el('fieldChart').getContext('2d');
    var keys = Object.keys(fieldCount).sort(function(a, b) { return fieldCount[b] - fieldCount[a]; });
    var values = keys.map(function(k) { return fieldCount[k]; });

    new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: keys,
        datasets: [{
          data: values,
          backgroundColor: ['#1685c5', '#238636', '#f39c12', '#9b59b6', '#e74c3c', '#95a5a6']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right' } }
      }
    });
  }

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
