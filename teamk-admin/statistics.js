(function() {
  'use strict';

  var api = window.TeamKAdminApi;
  var domain = window.TeamKDomain;
  var state = {
    spreadsheetId: '',
    token: '',
    games: [],
    selectedYear: String(new Date().getFullYear()),
    monthlyChart: null,
    fieldChart: null
  };

  function el(id) { return document.getElementById(id); }

  function init() {
    el('backButton').addEventListener('click', function() {
      window.location.href = 'index.html';
    });
    el('statisticsYear').addEventListener('change', function() {
      state.selectedYear = this.value;
      loadStatistics();
    });
    renderYearOptions([]);

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
    var requestedYear = state.selectedYear;
    el('statisticsYear').disabled = true;
    el('loadingMessage').textContent = requestedYear + '년 통계를 불러오는 중입니다...';
    el('loadingMessage').hidden = false;
    el('statsContent').hidden = true;
    api.post({
      type: 'admin_get_statistics',
      spreadsheetId: state.spreadsheetId,
      sessionToken: state.token,
      year: state.selectedYear
    }).then(function(data) {
      if (requestedYear !== state.selectedYear) return;
      state.games = data.games || [];
      renderYearOptions(data.availableYears || []);
      renderStatistics();
      el('loadingMessage').hidden = true;
      el('statsContent').hidden = false;
    }).catch(function(error) {
      if (requestedYear !== state.selectedYear) return;
      alert('통계 데이터를 불러오는데 실패했습니다: ' + error.message);
      el('loadingMessage').textContent = '데이터 로드 실패';
    }).finally(function() {
      if (requestedYear === state.selectedYear) {
        el('statisticsYear').disabled = false;
      }
    });
  }

  function renderYearOptions(years) {
    var options = {};
    options[state.selectedYear] = true;
    years.forEach(function(year) {
      if (/^\d{4}$/.test(String(year))) options[String(year)] = true;
    });
    var fragment = document.createDocumentFragment();
    Object.keys(options).sort().reverse().forEach(function(year) {
      var option = document.createElement('option');
      option.value = year;
      option.textContent = year + '년';
      option.selected = year === state.selectedYear;
      fragment.appendChild(option);
    });
    el('statisticsYear').replaceChildren(fragment);
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
        if (!rankingMap[name]) rankingMap[name] = { name: a.name, count: 0, dates: [] };
        if (rankingMap[name].dates.indexOf(g.gameInfo.date) === -1) {
          rankingMap[name].dates.push(g.gameInfo.date);
          rankingMap[name].count++;
        }
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
    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '해당 연도의 출석 기록이 없습니다.';
      container.appendChild(empty);
      return;
    }
    list.forEach(function(item, idx) {
      var row = document.createElement('details');
      row.className = 'ranking-item';

      var summary = document.createElement('summary');
      var summaryContent = document.createElement('span');
      summaryContent.className = 'ranking-summary-content';

      var rank = document.createElement('span');
      rank.className = 'ranking-rank';
      rank.textContent = (idx + 1);

      var name = document.createElement('strong');
      name.textContent = item.name;

      var count = document.createElement('span');
      count.className = 'ranking-count';
      count.textContent = item.count + '회';

      var dates = document.createElement('ul');
      dates.className = 'ranking-dates';
      item.dates.slice().sort().reverse().forEach(function(date) {
        var dateItem = document.createElement('li');
        dateItem.textContent = date;
        dates.appendChild(dateItem);
      });

      summaryContent.append(rank, name, count);
      summary.appendChild(summaryContent);
      row.append(summary, dates);
      container.appendChild(row);
    });
  }

  function renderMonthlyChart(monthCount) {
    var ctx = el('monthlyChart').getContext('2d');
    var keys = Object.keys(monthCount).sort();
    var values = keys.map(function(k) { return monthCount[k]; });

    if (state.monthlyChart) state.monthlyChart.destroy();
    state.monthlyChart = new Chart(ctx, {
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

    if (state.fieldChart) state.fieldChart.destroy();
    state.fieldChart = new Chart(ctx, {
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
