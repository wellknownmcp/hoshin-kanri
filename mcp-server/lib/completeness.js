/**
 * Completeness scoring for Hoshin Kanri X-Matrix
 * Pure functions - no database dependency.
 *
 * Ported from src/modules/matrices/services/completeness.service.js
 */

// Ideal element counts per quadrant
export const IDEAL_COUNTS = {
  north: { min: 1, ideal: { min: 3, max: 5 } },
  east: { min: 1, ideal: { min: 3, max: 7 } },
  south: { min: 1, ideal: { min: 5, max: 10 } },
  west: { min: 1, ideal: { min: 3, max: 6 } }
};

// Adjacent quadrant pairs for correlations (Hoshin standard)
export const CORRELATION_PAIRS = {
  NE: ['north', 'east'],
  SE: ['south', 'east'],
  SW: ['south', 'west'],
  NW: ['north', 'west']
};

// Score weights (total = 1.0)
export const WEIGHTS = {
  coverage: 0.15,
  density: 0.20,
  orphans: 0.20,
  chains: 0.25,
  indicatorBalance: 0.20
};

// Strength values for scoring
export const STRENGTH_VALUES = {
  none: 0,
  weak: 1,
  medium: 2,
  strong: 3
};

/**
 * Normalize a correlation object to snake_case fields
 * (JSON store uses camelCase, scoring functions expect snake_case)
 */
function normalizeCorrelation(c) {
  return {
    from_element_id: c.from_element_id || c.fromElementId,
    to_element_id: c.to_element_id || c.toElementId,
    from_quadrant: c.from_quadrant || c.fromQuadrant,
    to_quadrant: c.to_quadrant || c.toQuadrant,
    strength: c.strength
  };
}

/**
 * Compute completeness for a matrix object (in-memory, no SQL)
 *
 * @param {Object} matrix - { id, name, elements: { north, east, south, west }, correlations: [...] }
 * @returns {Object} completeness result
 */
export function computeCompleteness(matrix) {
  const elements = {
    north: (matrix.elements?.north || []).map(e => ({
      id: e.id,
      title: e.title,
      status: e.status,
      indicatorType: e.indicatorType || e.indicator_type
    })),
    east: (matrix.elements?.east || []).map(e => ({
      id: e.id,
      title: e.title,
      status: e.status,
      indicatorType: e.indicatorType || e.indicator_type
    })),
    south: (matrix.elements?.south || []).map(e => ({
      id: e.id,
      title: e.title,
      status: e.status,
      indicatorType: e.indicatorType || e.indicator_type
    })),
    west: (matrix.elements?.west || []).map(e => ({
      id: e.id,
      title: e.title,
      status: e.status,
      indicatorType: e.indicatorType || e.indicator_type
    }))
  };

  const correlations = (matrix.correlations || []).map(normalizeCorrelation);

  const coverageResult = calculateCoverage(elements);
  const densityResult = calculateDensity(elements, correlations);
  const orphansResult = calculateOrphans(elements, correlations);
  const chainsResult = calculateChains(elements, correlations);
  const indicatorBalanceResult = calculateIndicatorBalance(elements, correlations);

  const globalScore = Math.round(
    coverageResult.score * WEIGHTS.coverage +
    densityResult.score * WEIGHTS.density +
    orphansResult.score * WEIGHTS.orphans +
    chainsResult.score * WEIGHTS.chains +
    indicatorBalanceResult.score * WEIGHTS.indicatorBalance
  );

  const level = getLevel(globalScore);
  const suggestions = generateSuggestions(coverageResult, densityResult, orphansResult, chainsResult, indicatorBalanceResult);
  const aiContext = generateAIContext(matrix.name, globalScore, level, elements, orphansResult, chainsResult, indicatorBalanceResult);

  return {
    matrixId: matrix.id,
    matrixName: matrix.name,
    score: globalScore,
    level: level.key,
    levelLabel: level.label,
    details: {
      coverage: coverageResult,
      density: densityResult,
      orphans: orphansResult,
      chains: chainsResult,
      indicatorBalance: indicatorBalanceResult
    },
    suggestions,
    aiContext
  };
}

// ============================================
// SCORING FUNCTIONS (pure, no I/O)
// ============================================

function calculateCoverage(elements) {
  const details = {};
  let totalScore = 0;

  for (const [quadrant, config] of Object.entries(IDEAL_COUNTS)) {
    const count = elements[quadrant].length;
    let status = 'ok';
    let quadrantScore = 100;

    if (count === 0) {
      status = 'empty';
      quadrantScore = 0;
    } else if (count < config.min) {
      status = 'critical';
      quadrantScore = 25;
    } else if (count < config.ideal.min) {
      status = 'low';
      quadrantScore = 60;
    } else if (count > config.ideal.max) {
      status = 'high';
      quadrantScore = 80;
    }

    details[quadrant] = {
      count,
      min: config.min,
      ideal: `${config.ideal.min}-${config.ideal.max}`,
      status,
      score: quadrantScore
    };

    totalScore += quadrantScore;
  }

  return { score: Math.round(totalScore / 4), ...details };
}

function calculateDensity(elements, correlations) {
  const details = {};
  let totalScore = 0;
  let validPairs = 0;

  for (const [corner, [q1, q2]] of Object.entries(CORRELATION_PAIRS)) {
    const e1 = elements[q1];
    const e2 = elements[q2];
    const possible = e1.length * e2.length;

    if (possible === 0) {
      details[corner] = { possible: 0, actual: 0, density: 0, level: 'n/a', score: 0 };
      continue;
    }

    const actual = correlations.filter(c => {
      const fromQ = c.from_quadrant;
      const toQ = c.to_quadrant;
      return (
        (fromQ === q1 && toQ === q2) ||
        (fromQ === q2 && toQ === q1)
      ) && c.strength !== 'none';
    }).length;

    const density = actual / possible;
    let level = 'sparse';
    let cornerScore = 0;

    if (density >= 0.8) { level = 'rich'; cornerScore = 100; }
    else if (density >= 0.5) { level = 'good'; cornerScore = 75; }
    else if (density >= 0.2) { level = 'minimal'; cornerScore = 50; }
    else if (density > 0) { level = 'sparse'; cornerScore = 25; }

    details[corner] = {
      possible, actual,
      density: Math.round(density * 100) / 100,
      level, score: cornerScore
    };

    totalScore += cornerScore;
    validPairs++;
  }

  return { score: validPairs > 0 ? Math.round(totalScore / validPairs) : 0, ...details };
}

function calculateOrphans(elements, correlations) {
  const orphanElements = [];
  let totalElements = 0;

  const linkedIds = new Set();
  for (const c of correlations) {
    if (c.strength !== 'none') {
      linkedIds.add(c.from_element_id);
      linkedIds.add(c.to_element_id);
    }
  }

  for (const [quadrant, items] of Object.entries(elements)) {
    for (const el of items) {
      totalElements++;
      if (!linkedIds.has(el.id)) {
        orphanElements.push({ id: el.id, quadrant, title: el.title });
      }
    }
  }

  const orphanCount = orphanElements.length;
  let score = 100;

  if (totalElements > 0) {
    const orphanRatio = orphanCount / totalElements;
    if (orphanRatio >= 0.5) score = 20;
    else if (orphanRatio >= 0.3) score = 40;
    else if (orphanRatio >= 0.15) score = 60;
    else if (orphanRatio > 0) score = 80;
  }

  return { score, count: orphanCount, total: totalElements, elements: orphanElements };
}

function buildAdjacencyMap(correlations) {
  const map = new Map();

  for (const c of correlations) {
    if (c.strength === 'none') continue;

    if (!map.has(c.from_element_id)) map.set(c.from_element_id, new Set());
    map.get(c.from_element_id).add(c.to_element_id);

    if (!map.has(c.to_element_id)) map.set(c.to_element_id, new Set());
    map.get(c.to_element_id).add(c.from_element_id);
  }

  return map;
}

function findLinkedElements(sourceId, targetElements, adjacency) {
  const linkedIds = adjacency.get(sourceId) || new Set();
  return targetElements.filter(el => linkedIds.has(el.id));
}

function calculateChains(elements, correlations) {
  const chainDetails = [];
  const adjacency = buildAdjacencyMap(correlations);

  for (const northEl of elements.north) {
    const linkedEast = findLinkedElements(northEl.id, elements.east, adjacency);

    const linkedSouth = [];
    for (const eastEl of linkedEast) {
      linkedSouth.push(...findLinkedElements(eastEl.id, elements.south, adjacency));
    }
    const uniqueSouth = [...new Map(linkedSouth.map(e => [e.id, e])).values()];

    const linkedWest = [];
    for (const southEl of uniqueSouth) {
      linkedWest.push(...findLinkedElements(southEl.id, elements.west, adjacency));
    }
    const uniqueWest = [...new Map(linkedWest.map(e => [e.id, e])).values()];

    const isComplete = uniqueWest.length > 0;
    const missing = [];
    if (linkedEast.length === 0) missing.push('east');
    if (uniqueSouth.length === 0 && linkedEast.length > 0) missing.push('south');
    if (uniqueWest.length === 0 && uniqueSouth.length > 0) missing.push('west');

    chainDetails.push({
      vision: northEl.title,
      visionId: northEl.id,
      path: {
        east: linkedEast.map(e => e.title),
        south: uniqueSouth.map(e => e.title),
        west: uniqueWest.map(e => e.title)
      },
      complete: isComplete,
      missing
    });
  }

  const complete = chainDetails.filter(c => c.complete).length;
  const incomplete = chainDetails.filter(c => !c.complete).length;
  const total = chainDetails.length;

  let score = 0;
  if (total > 0) {
    score = Math.round((complete / total) * 100);
  }

  return { score, complete, incomplete, total, details: chainDetails };
}

function calculateIndicatorBalance(elements, correlations) {
  const westElements = elements.west;

  const resultIndicators = westElements.filter(e => e.indicatorType === 'result');
  const performanceIndicators = westElements.filter(e => e.indicatorType === 'performance');
  const unclassifiedIndicators = westElements.filter(e => !e.indicatorType);

  const adjacency = buildAdjacencyMap(correlations);

  const eastAnalysis = analyzeIndicatorLinks(elements.east, resultIndicators, performanceIndicators, adjacency);
  const southAnalysis = analyzeIndicatorLinks(elements.south, resultIndicators, performanceIndicators, adjacency);

  const eastScore = eastAnalysis.total > 0
    ? Math.round((eastAnalysis.balanced / eastAnalysis.total) * 100)
    : (elements.east.length === 0 ? 0 : 100);

  const southScore = southAnalysis.total > 0
    ? Math.round((southAnalysis.balanced / southAnalysis.total) * 100)
    : (elements.south.length === 0 ? 0 : 100);

  const totalAnalyzed = eastAnalysis.total + southAnalysis.total;
  const totalBalanced = eastAnalysis.balanced + southAnalysis.balanced;
  const overallScore = totalAnalyzed > 0
    ? Math.round((totalBalanced / totalAnalyzed) * 100)
    : 0;

  return {
    score: overallScore,
    kpiStats: {
      total: westElements.length,
      result: resultIndicators.length,
      performance: performanceIndicators.length,
      unclassified: unclassifiedIndicators.length
    },
    east: { ...eastAnalysis, score: eastScore },
    south: { ...southAnalysis, score: southScore },
    unbalancedElements: [
      ...eastAnalysis.details.filter(d => !d.balanced),
      ...southAnalysis.details.filter(d => !d.balanced)
    ]
  };
}

function analyzeIndicatorLinks(elements, resultIndicators, performanceIndicators, adjacency) {
  const details = [];
  let balanced = 0;
  let hasResult = 0;
  let hasPerformance = 0;
  let hasBoth = 0;
  let hasNeither = 0;

  for (const el of elements) {
    const linkedIds = adjacency.get(el.id) || new Set();

    const hasResultLink = resultIndicators.some(ri => linkedIds.has(ri.id));
    const hasPerfLink = performanceIndicators.some(pi => linkedIds.has(pi.id));

    const isBalanced = hasResultLink && hasPerfLink;

    if (isBalanced) { balanced++; hasBoth++; }
    else if (hasResultLink && !hasPerfLink) { hasResult++; }
    else if (hasPerfLink && !hasResultLink) { hasPerformance++; }
    else { hasNeither++; }

    details.push({
      id: el.id,
      title: el.title,
      hasResult: hasResultLink,
      hasPerformance: hasPerfLink,
      balanced: isBalanced,
      missing: !hasResultLink && !hasPerfLink ? 'both'
             : !hasResultLink ? 'result'
             : !hasPerfLink ? 'performance'
             : null
    });
  }

  return {
    total: elements.length,
    balanced,
    hasBoth,
    hasResultOnly: hasResult,
    hasPerformanceOnly: hasPerformance,
    hasNeither,
    details
  };
}

// `key` is a stable API identifier (French heritage — renaming it would break
// existing consumers); `label` is the English gloss for the agent surface. A UI
// localises from `key` via its own dictionary and ignores `label`.
function getLevel(score) {
  if (score >= 86) return { key: 'excellent', label: 'Excellent' };
  if (score >= 71) return { key: 'bon', label: 'Good' };
  if (score >= 51) return { key: 'acceptable', label: 'Acceptable' };
  if (score >= 31) return { key: 'minimal', label: 'Minimal' };
  return { key: 'incomplet', label: 'Incomplete' };
}

function getQuadrantLabel(quadrant) {
  const labels = {
    north: 'Vision (North)',
    east: 'Annual objectives (East)',
    south: 'Initiatives (South)',
    west: 'KPIs (West)'
  };
  return labels[quadrant] || quadrant;
}

/**
 * Suggestions are machine-readable first: `code` + `params` let any UI render
 * them in the reader's language, `message` is the English rendering relayed to
 * the agent. `params` carry raw keys (a quadrant travels as `north`), never
 * localised text — interpolating an English label into a translated sentence is
 * the bug this shape prevents.
 *
 * Kept identical to src/lib/completeness.ts in the web app: the same matrix must
 * score — and explain itself — the same way in sovereign mode and in the cloud.
 */
function generateSuggestions(coverage, density, orphans, chains, indicatorBalance) {
  const suggestions = [];
  const push = (code, params, message) => suggestions.push({ code, params, message });

  for (const [quadrant, data] of Object.entries(coverage)) {
    if (quadrant === 'score') continue;
    if (data.status === 'empty') {
      push('coverage.empty', { quadrant }, `Add at least 1 element to the ${getQuadrantLabel(quadrant)} quadrant`);
    } else if (data.status === 'low') {
      // `status: 'low'` means the quadrant clears its hard minimum but sits
      // under the *recommended* range, which is what the message promises to
      // close — measuring against `min` here produced "add 0 element(s)".
      const count = IDEAL_COUNTS[quadrant].ideal.min - data.count;
      push(
        'coverage.low',
        { quadrant, count },
        `Add ${count} element(s) to ${getQuadrantLabel(quadrant)} to reach the recommended minimum`
      );
    }
  }

  for (const [corner, data] of Object.entries(density)) {
    if (corner === 'score') continue;
    if (data.level === 'sparse' && data.possible > 0) {
      const [q1, q2] = CORRELATION_PAIRS[corner];
      push(
        'density.sparse',
        { corner, from: q1, to: q2 },
        `Create more correlations between ${getQuadrantLabel(q1)} and ${getQuadrantLabel(q2)}`
      );
    }
  }

  if (orphans.count > 0) {
    const orphansByQuadrant = {};
    for (const o of orphans.elements) {
      if (!orphansByQuadrant[o.quadrant]) orphansByQuadrant[o.quadrant] = [];
      orphansByQuadrant[o.quadrant].push(o.title);
    }
    for (const [quadrant, titles] of Object.entries(orphansByQuadrant)) {
      if (titles.length === 1) {
        push(
          'orphans.one',
          { quadrant, title: titles[0] },
          `Link "${titles[0]}" (${getQuadrantLabel(quadrant)}) to an adjacent element`
        );
      } else {
        push(
          'orphans.many',
          { quadrant, count: titles.length },
          `${titles.length} orphan elements in ${getQuadrantLabel(quadrant)} to link`
        );
      }
    }
  }

  for (const chain of chains.details) {
    if (!chain.complete && chain.missing.length > 0) {
      const missingLabels = chain.missing.map(getQuadrantLabel).join(', ');
      push(
        'chains.incomplete',
        { vision: chain.vision, missing: chain.missing },
        `Vision "${chain.vision}" has no complete chain (missing: ${missingLabels})`
      );
    }
  }

  if (indicatorBalance) {
    if (indicatorBalance.kpiStats.unclassified > 0) {
      push(
        'balance.unclassified',
        { count: indicatorBalance.kpiStats.unclassified },
        `${indicatorBalance.kpiStats.unclassified} KPI(s) with no type set (result or performance)`
      );
    }
    if (indicatorBalance.kpiStats.result === 0 && indicatorBalance.kpiStats.total > 0) {
      push('balance.noResult', {}, 'No result (lagging) indicator defined — add KPIs measuring outcomes');
    }
    if (indicatorBalance.kpiStats.performance === 0 && indicatorBalance.kpiStats.total > 0) {
      push('balance.noPerformance', {}, 'No performance (leading) indicator defined — add KPIs measuring processes');
    }
    const unbalanced = indicatorBalance.unbalancedElements.slice(0, 3);
    for (const el of unbalanced) {
      if (el.missing === 'both') {
        push('balance.missingBoth', { title: el.title }, `"${el.title}" is linked to no KPI — add both result and performance`);
      } else if (el.missing === 'result') {
        push('balance.missingResult', { title: el.title }, `"${el.title}" is missing a result (lagging) indicator`);
      } else if (el.missing === 'performance') {
        push('balance.missingPerformance', { title: el.title }, `"${el.title}" is missing a performance (leading) indicator`);
      }
    }
  }

  return suggestions.slice(0, 12);
}

function generateAIContext(matrixName, score, level, elements, orphans, chains, indicatorBalance) {
  const counts = {
    north: elements.north.length,
    east: elements.east.length,
    south: elements.south.length,
    west: elements.west.length
  };

  const parts = [
    `Matrix "${matrixName}" — score ${score}/100 (${level.label}).`,
    `Elements: ${counts.north} vision(s), ${counts.east} annual objective(s), ${counts.south} initiative(s), ${counts.west} KPI(s).`
  ];

  if (indicatorBalance && indicatorBalance.kpiStats.total > 0) {
    const { result, performance, unclassified } = indicatorBalance.kpiStats;
    parts.push(`KPIs: ${result} result (lagging), ${performance} performance (leading)${unclassified > 0 ? `, ${unclassified} unclassified` : ''}.`);

    const balanceRate = indicatorBalance.score;
    if (balanceRate < 50) {
      parts.push(`Weak indicator balance (${balanceRate}%): objectives and initiatives lack KPIs of both types.`);
    } else if (balanceRate < 80) {
      parts.push(`Partial indicator balance (${balanceRate}%): some elements only have one KPI type.`);
    }
  }

  if (orphans.count > 0) {
    parts.push(`${orphans.count} orphan element(s) with no correlation.`);
  }
  if (chains.incomplete > 0) {
    parts.push(`${chains.incomplete}/${chains.total} vision(s) with no complete chain down to a KPI.`);
  }

  if (score >= 71) {
    parts.push('Well structured, ready for a strategic review.');
  } else if (score >= 51) {
    parts.push('Acceptable structure, some improvements possible.');
  } else {
    parts.push('Incomplete: add elements and correlations.');
  }

  return parts.join(' ');
}
