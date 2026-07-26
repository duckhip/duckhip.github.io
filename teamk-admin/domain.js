(function(global) {
  'use strict';

  function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  function sameId(left, right) {
    return String(left == null ? '' : left) === String(right == null ? '' : right);
  }

  function hasDuplicateAttendee(attendees, name, excludeId) {
    return (attendees || []).some(function(item) {
      return !sameId(item.id, excludeId) && normalizeName(item.name) === normalizeName(name);
    });
  }

  function upsertAttendee(attendees, input) {
    var list = attendees || [];
    var existing = list.find(function(item) { return sameId(item.id, input.id); });
    var attendee = createAttendee({
      id: input.id,
      name: input.name,
      paid: input.paid == null ? (existing ? existing.paid : true) : input.paid,
      minor: input.minor,
      note: input.note
    });
    if (!existing) return list.concat(attendee);
    return list.map(function(item) { return sameId(item.id, input.id) ? attendee : item; });
  }

  function addAttendeeGroup(attendees, input) {
    var minorCount = Math.max(0, Math.min(5, parseInt(input.minorCount, 10) || 0));
    var next = upsertAttendee(attendees, {
      id: '',
      name: input.name,
      paid: input.paid,
      minor: false,
      note: input.note
    });
    for (var index = 1; index <= minorCount; index++) {
      next = upsertAttendee(next, {
        id: '',
        name: input.name + '+소인' + index,
        paid: input.paid,
        minor: true,
        note: input.note
      });
    }
    return next;
  }

  function deleteAttendee(attendees, id) {
    return (attendees || []).filter(function(item) { return !sameId(item.id, id); });
  }

  function createProgressTracker(onChange) {
    var depth = 0;
    return {
      begin: function(message) {
        depth++;
        onChange(true, message, depth);
      },
      end: function() {
        depth = Math.max(0, depth - 1);
        onChange(depth > 0, '', depth);
      },
      depth: function() { return depth; }
    };
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
    var list = attendees || [];
    var paidCount = 0;
    var adults = 0;
    var minors = 0;
    list.forEach(function(item) {
      if (!item.paid) return;
      paidCount++;
      if (item.minor) minors++;
      else adults++;
    });
    return {
      totalCount: list.length,
      paidCount: paidCount,
      adultCount: adults,
      minorCount: minors,
      gameFeeTotal: adults * fee + minors * Math.max(fee - 15000, 0),
      fieldPaymentTotal: adults * Math.max(fee - 5000, 0) + minors * Math.max(fee - 15000, 0)
    };
  }

  function mergeSubmissions(attendees, submissions) {
    var next = (attendees || []).map(createAttendee);
    var adultNames = new Set();
    var ids = [];
    var skipped = 0;
    next.forEach(function(item) {
      if (!item.minor) adultNames.add(normalizeName(item.name));
    });
    (submissions || []).forEach(function(submission) {
      var baseName = String(submission.name || '').trim();
      var normalizedName = normalizeName(baseName);
      if (!normalizedName || adultNames.has(normalizedName)) {
        skipped++;
        return;
      }
      next.push(createAttendee({ name: baseName, paid: true, note: submission.note }));
      adultNames.add(normalizedName);
      for (var i = 1; i <= Math.min(5, Number(submission.minorCount) || 0); i++) {
        next.push(createAttendee({ name: baseName + '+소인' + i, paid: true, minor: true, note: submission.note }));
      }
      ids.push(String(submission.submissionId));
    });
    return { attendees: next, submissionIds: ids, skipped: skipped };
  }

  global.TeamKDomain = {
    normalizeName: normalizeName,
    sameId: sameId,
    hasDuplicateAttendee: hasDuplicateAttendee,
    upsertAttendee: upsertAttendee,
    addAttendeeGroup: addAttendeeGroup,
    deleteAttendee: deleteAttendee,
    createProgressTracker: createProgressTracker,
    createAttendee: createAttendee,
    calculateSummary: calculateSummary,
    mergeSubmissions: mergeSubmissions
  };
})(window);
