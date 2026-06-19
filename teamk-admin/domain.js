(function(global) {
  'use strict';

  function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  function createAttendee(input) {
    return {
      id: String(input.id || (Date.now() + Math.random())),
      name: String(input.name || '').trim(),
      paid: Boolean(input.paid),
      team: 'Team-K',
      minor: Boolean(input.minor),
      note: String(input.note || '').trim()
    };
  }

  function calculateSummary(gameInfo, attendees) {
    var fee = Math.max(0, parseInt(gameInfo && gameInfo.fee, 10) || 0);
    var paid = (attendees || []).filter(function(item) { return item.paid; });
    var adults = paid.filter(function(item) { return !item.minor; }).length;
    var minors = paid.length - adults;
    return {
      totalCount: (attendees || []).length,
      paidCount: paid.length,
      adultCount: adults,
      minorCount: minors,
      gameFeeTotal: adults * fee + minors * Math.max(fee - 15000, 0),
      fieldPaymentTotal: adults * Math.max(fee - 5000, 0) + minors * Math.max(fee - 15000, 0)
    };
  }

  function mergeSubmissions(attendees, submissions) {
    var next = (attendees || []).map(createAttendee);
    var ids = [];
    var skipped = 0;
    (submissions || []).forEach(function(submission) {
      var baseName = String(submission.name || '').trim();
      var exists = next.some(function(item) {
        return !item.minor && normalizeName(item.name) === normalizeName(baseName);
      });
      if (exists) {
        skipped++;
        return;
      }
      next.push(createAttendee({ name: baseName, paid: true, note: submission.note }));
      for (var i = 1; i <= Math.min(5, Number(submission.minorCount) || 0); i++) {
        next.push(createAttendee({ name: baseName + '+소인' + i, paid: true, minor: true, note: submission.note }));
      }
      ids.push(String(submission.submissionId));
    });
    return { attendees: next, submissionIds: ids, skipped: skipped };
  }

  global.TeamKDomain = {
    normalizeName: normalizeName,
    createAttendee: createAttendee,
    calculateSummary: calculateSummary,
    mergeSubmissions: mergeSubmissions
  };
})(window);
