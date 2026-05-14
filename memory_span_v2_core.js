(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MemorySpanV2Core = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FIXATION_MS = 500;
  const STIMULUS_MS = 700;
  const GAP_MS = 300;
  const SET_SIZES = [4, 6];
  const RETENTION_INTERVALS_MS = [1000, 4000];
  const MAIN_REPETITIONS_PER_CONDITION = 6;
  const PRACTICE_REPETITIONS = 1;
  const DIGIT_POOL = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const CONDITIONS = [
    { condition: 'A', setSize: 4, retentionMs: 1000 },
    { condition: 'B', setSize: 4, retentionMs: 4000 },
    { condition: 'C', setSize: 6, retentionMs: 1000 },
    { condition: 'D', setSize: 6, retentionMs: 4000 },
  ];
  const CSV_COLUMNS = [
    'participant_id',
    'trial_number',
    'practice_or_main',
    'timestamp',
    'condition',
    'set_size',
    'retention_interval_ms',
    'stimulus_sequence',
    'response_sequence',
    'reaction_time_ms',
    'exact_accuracy',
    'partial_accuracy',
    'pos1_correct',
    'pos2_correct',
    'pos3_correct',
    'pos4_correct',
    'pos5_correct',
    'pos6_correct',
  ];

  function shuffleItems(items, random = Math.random) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
  }

  function generateDigitSequence(length, random = Math.random) {
    if (length > DIGIT_POOL.length) {
      throw new RangeError('set size cannot exceed the number of available unique digits');
    }
    return shuffleItems(DIGIT_POOL, random).slice(0, length);
  }

  function makeTrial({ condition, setSize, retentionMs, practice = false, random = Math.random }) {
    return {
      condition: practice ? `practice_${setSize}_${retentionMs}` : condition,
      setSize,
      retentionMs,
      practice,
      stimulusMs: STIMULUS_MS,
      gapMs: GAP_MS,
      fixationMs: FIXATION_MS,
      sequence: generateDigitSequence(setSize, random),
    };
  }

  function buildPracticeTrials({ random = Math.random } = {}) {
    const trials = [];
    CONDITIONS.forEach((condition) => {
      for (let repeat = 0; repeat < PRACTICE_REPETITIONS; repeat += 1) {
        trials.push(makeTrial({ ...condition, practice: true, random }));
      }
    });
    return trials;
  }

  function buildMainTrials({ random = Math.random, shuffle = shuffleItems } = {}) {
    const trials = [];
    CONDITIONS.forEach((condition) => {
      for (let repeat = 0; repeat < MAIN_REPETITIONS_PER_CONDITION; repeat += 1) {
        trials.push(makeTrial({ ...condition, practice: false, random }));
      }
    });
    return shuffle(trials, random);
  }

  function normalizeResponse(response) {
    return String(response || '').replace(/\D/g, '').split('').filter(Boolean);
  }

  function scoreResponse(sequence, response) {
    const normalizedResponse = normalizeResponse(response);
    const positionCorrect = sequence.map((item, index) => normalizedResponse[index] === item ? 1 : 0);
    const exactAccuracy = normalizedResponse.length === sequence.length && positionCorrect.every(Boolean) ? 1 : 0;
    const partialAccuracy = sequence.length
      ? positionCorrect.reduce((sum, value) => sum + value, 0) / sequence.length
      : 0;
    return { normalizedResponse, exactAccuracy, partialAccuracy, positionCorrect };
  }

  function createResultRow({
    participantId,
    trialNumber,
    practice,
    trial,
    response,
    reactionTimeMs,
    timestamp = new Date().toISOString(),
  }) {
    const score = scoreResponse(trial.sequence, response);
    const row = {
      participant_id: participantId,
      trial_number: trialNumber,
      practice_or_main: practice ? 'practice' : 'main',
      timestamp,
      condition: trial.condition,
      set_size: trial.setSize,
      retention_interval_ms: trial.retentionMs,
      stimulus_sequence: trial.sequence.join(''),
      response_sequence: score.normalizedResponse.join(''),
      reaction_time_ms: Math.round(reactionTimeMs),
      exact_accuracy: score.exactAccuracy,
      partial_accuracy: Number(score.partialAccuracy.toFixed(4)),
    };

    for (let index = 0; index < 6; index += 1) {
      row[`pos${index + 1}_correct`] = index < trial.sequence.length ? score.positionCorrect[index] : '';
    }

    return row;
  }

  function summarizeResults(rows) {
    const mainRows = rows.filter((row) => row.practice_or_main === 'main');
    const totalTrials = mainRows.length;
    const exactAccuracy = totalTrials
      ? mainRows.reduce((sum, row) => sum + Number(row.exact_accuracy), 0) / totalTrials
      : 0;
    const partialAccuracy = totalTrials
      ? mainRows.reduce((sum, row) => sum + Number(row.partial_accuracy), 0) / totalTrials
      : 0;
    const byCondition = {};

    mainRows.forEach((row) => {
      const key = row.condition;
      if (!byCondition[key]) {
        byCondition[key] = {
          condition: row.condition,
          setSize: row.set_size,
          retentionMs: row.retention_interval_ms,
          total: 0,
          exact: 0,
          partial: 0,
          rt: 0,
        };
      }
      byCondition[key].total += 1;
      byCondition[key].exact += Number(row.exact_accuracy);
      byCondition[key].partial += Number(row.partial_accuracy);
      byCondition[key].rt += Number(row.reaction_time_ms);
    });

    Object.values(byCondition).forEach((entry) => {
      entry.exactAccuracy = entry.total ? entry.exact / entry.total : 0;
      entry.partialAccuracy = entry.total ? entry.partial / entry.total : 0;
      entry.meanRt = entry.total ? entry.rt / entry.total : 0;
    });

    return { totalTrials, exactAccuracy, partialAccuracy, byCondition };
  }

  function escapeCsv(value) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function toCsv(rows) {
    const lines = [CSV_COLUMNS.join(',')];
    rows.forEach((row) => {
      lines.push(CSV_COLUMNS.map((column) => escapeCsv(row[column])).join(','));
    });
    return lines.join('\n');
  }

  function buildSheetsPayload({ participantId, rows }) {
    return {
      participant_id: participantId,
      task_version: 'v2',
      row_count: rows.length,
      rows,
    };
  }

  return {
    FIXATION_MS,
    STIMULUS_MS,
    GAP_MS,
    SET_SIZES,
    RETENTION_INTERVALS_MS,
    MAIN_REPETITIONS_PER_CONDITION,
    PRACTICE_REPETITIONS,
    CONDITIONS,
    CSV_COLUMNS,
    shuffleItems,
    generateDigitSequence,
    buildPracticeTrials,
    buildMainTrials,
    scoreResponse,
    createResultRow,
    summarizeResults,
    toCsv,
    buildSheetsPayload,
  };
}));
