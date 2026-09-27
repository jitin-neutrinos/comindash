// Plain-English help copy for every metric, chart and panel in the dashboard.
// One entry per `infoKey`. `links` is optional — when present, the info panel
// draws a small hub-and-spoke map of the related metrics.
export const METRIC_INFO = {
  /* ---- KPI metrics ------------------------------------------------------ */
  totalPosts: {
    title: 'Total posts',
    what: 'Every community post we have collected. Think of it as the size of the pile of mail that arrived.',
    how: 'A straight count of posts pulled from the community, before any AI reads or filters them.',
    fresh: 'Live — goes up on every sync.',
    links: ['avgSentiment', 'highPriority', 'activePainPoints', 'modelConfidence'],
  },
  avgSentiment: {
    title: 'Avg sentiment',
    what: 'The mood of the room, scored from −1 (unhappy) to +1 (happy). Zero means neutral.',
    how: 'Each post gets a mood score from the AI, then we take the plain average of all of them.',
    fresh: 'Worked out fresh each time you open the page.',
    links: ['totalPosts', 'activePainPoints', 'modelConfidence'],
  },
  highPriority: {
    title: 'High-priority posts',
    what: 'Posts that need a human to look at them soon — the ones you would flag in an inbox.',
    how: 'The AI reads each post for urgency, tone and how many people it affects, then flags the pressing ones.',
    fresh: 'Live — updated as posts are processed.',
    links: ['totalPosts', 'activePainPoints'],
  },
  activePainPoints: {
    title: 'Active pain points',
    what: 'Distinct problems people are hitting right now. Many posts about one problem count as one pain point.',
    how: 'The AI groups similar urgent and unhappy posts together and names the shared problem behind them.',
    fresh: 'Rebuilt overnight.',
    links: ['avgSentiment', 'highPriority', 'totalPosts'],
  },
  modelConfidence: {
    title: 'Model confidence',
    what: 'How sure the AI is about its own answers. High means trust the numbers; low means read the posts yourself.',
    how: 'Averaged across every AI step — mood, priority and topic — on a 0 to 100% scale.',
    fresh: 'Worked out fresh each time you open the page.',
    links: ['totalPosts', 'avgSentiment'],
  },

  /* ---- Pages ------------------------------------------------------------ */
  overviewPage: {
    title: 'Overview',
    what: 'The dashboard front page — the headline numbers plus the loudest problems, all on one screen.',
    how: 'Pulls the five key numbers, the last 30 days of post volume, and the top three pain points.',
    fresh: 'Live numbers; pain points refresh overnight.',
    links: ['totalPosts', 'avgSentiment', 'highPriority', 'activePainPoints'],
  },
  metricsPage: {
    title: 'Metrics explorer',
    what: 'The dashboard’s metrics room — trends over time, plus the pipeline runs and model confidence behind the numbers.',
    how: 'Charts daily totals for the measure and window you pick; the panels below read run history and model confidence straight from the API.',
    fresh: 'Trends and runs are live; insights refresh overnight.',
    links: ['totalPosts', 'avgSentiment', 'highPriority', 'modelConfidence'],
  },
  painPointsPage: {
    title: 'Pain points',
    what: 'The full list of problems the AI found, worst first, each one backed by real quotes from posts.',
    how: 'Urgent and unhappy posts are grouped into themes, then each theme is rated high, medium or low severity.',
    fresh: 'Rebuilt overnight.',
    links: ['activePainPoints', 'highPriority', 'avgSentiment'],
  },
  relationshipsPage: {
    title: 'Relationships',
    what: 'A map of which things people mention together — like a seating chart showing who talks to whom.',
    how: 'The AI pulls names, products and topics out of posts and draws a line whenever two keep appearing together.',
    fresh: 'Rebuilt overnight.',
    links: ['totalPosts', 'activePainPoints'],
  },
  explorerPage: {
    title: 'Data explorer',
    what: 'The raw material behind every chart — the actual topics and posts, searchable.',
    how: 'Reads straight from the stored posts and topics, 20 rows at a time, with the AI labels attached.',
    fresh: 'Live — shows what is in storage right now.',
    links: ['totalPosts', 'highPriority'],
  },
  insightPage: {
    title: 'Insight detail',
    what: 'One pain point in full: what the AI concluded, the quotes it relied on, and what it connects to.',
    how: 'Every insight keeps a link back to the posts it came from, so you can check the working.',
    fresh: 'Rebuilt overnight with the rest of the insights.',
    links: ['activePainPoints', 'modelConfidence'],
  },
  adminPage: {
    title: 'Platform enablement',
    what: 'The engine room — logs, traffic, job history and a security trail. Useful when something looks wrong.',
    how: 'Reads live from the running services rather than from the analysed data.',
    fresh: 'Logs refresh every 10 seconds; charts every 30.',
  },
  settingsPage: {
    title: 'Settings',
    what: 'Where workspace and pipeline options will live.',
    how: 'Not wired up yet.',
    fresh: 'Not applicable.',
  },

  /* ---- Overview cards --------------------------------------------------- */
  volumeTrend: {
    title: 'Post volume — last 30 days',
    what: 'How many posts arrived each day for the past month. Spikes usually mean something broke or launched.',
    how: 'Posts are bucketed by the day they were written and counted.',
    fresh: 'Live — today’s bar grows through the day.',
    links: ['totalPosts', 'highPriority'],
  },
  topPains: {
    title: 'Top pain points',
    what: 'The three problems the AI rates as most severe right now.',
    how: 'The full pain-point list sorted by severity; only the top three are shown here.',
    fresh: 'Rebuilt overnight.',
    links: ['activePainPoints', 'highPriority'],
  },

  /* ---- Metrics explorer charts ------------------------------------------ */
  trendVolume: {
    title: 'Post volume over time',
    what: 'The daily count of new posts. A rising line means the community is getting busier.',
    how: 'Posts grouped by day across the window you picked.',
    fresh: 'Live.',
    links: ['totalPosts'],
  },
  trendSentiment: {
    title: 'Sentiment over time',
    what: 'The daily mood average. A line sliding below zero means the room is turning unhappy.',
    how: 'Each day’s posts are scored −1 to +1 by the AI and averaged for that day.',
    fresh: 'Live.',
    links: ['avgSentiment', 'activePainPoints'],
  },
  trendPriority: {
    title: 'Priority mix',
    what: 'The split between high, medium and low priority posts — how much of the pile is actually urgent.',
    how: 'Each post is graded by the AI, then the grades are totalled across the window.',
    fresh: 'Live.',
    links: ['highPriority', 'totalPosts'],
  },
  trendEntity: {
    title: 'Entities',
    what: 'The names, products and features people mention most. A quick read on what the community is talking about.',
    how: 'The AI pulls names out of each post; the ten most mentioned are ranked here.',
    fresh: 'Live.',
    links: ['totalPosts'],
  },

  /* ---- Metrics & model observability ------------------------------------ */
  tabInsight: {
    title: 'Tab insights',
    what: 'A short read on whichever metric tab is selected above — volume, sentiment, priority mix or entities — built from the real numbers in the current window.',
    how: 'Computed live from the trend data and overview totals for the selected tab and day window; nothing here is fixed text.',
    fresh: 'Live — recalculates on every tab or window change.',
    links: ['metricsPage'],
  },
  tabHighlights: {
    title: 'Tab highlight',
    what: 'The headline number for whichever metric tab is selected above.',
    how: 'Same data behind the chart and the insight panel, reduced to one number.',
    fresh: 'Live.',
    links: ['metricsPage'],
  },
  insightSeverity: {
    title: 'Insight severity',
    what: 'How the assistant’s active pain-point insights split by severity — the shape of the workload behind the headline count.',
    how: 'Active pain-point insights grouped by their severity rating and counted.',
    fresh: 'Live counts over insights rebuilt overnight.',
    links: ['activePainPoints', 'highPriority'],
  },

  /* ---- Pain points ------------------------------------------------------ */
  severityMix: {
    title: 'Severity mix',
    what: 'How the problems break down by how bad they are — the shape of the workload, not its size.',
    how: 'Every pain point is rated high, medium or low, then counted into the ring.',
    fresh: 'Rebuilt overnight.',
    links: ['activePainPoints', 'highPriority'],
  },

  painPointItem: {
    title: 'Pain point',
    what: 'One problem the assistant found, written up in plain words, with a severity badge and a count of the posts that back it up.',
    how: 'Posts complaining about the same thing are grouped together; the group is summarised and rated high, medium or low severity.',
    fresh: 'Rebuilt overnight.',
    links: ['activePainPoints', 'highPriority', 'avgSentiment'],
  },

  /* ---- Relationships ---------------------------------------------------- */
  connectionMap: {
    title: 'Connection map',
    what: 'Dots are things people mention; lines mean the two get mentioned together. Thicker line, stronger link.',
    how: 'The AI extracts entities and topics per post and scores how often each pair co-occurs.',
    fresh: 'Rebuilt overnight.',
    links: ['totalPosts', 'activePainPoints'],
  },

  /* ---- Data explorer ---------------------------------------------------- */
  topicsTable: {
    title: 'Topics',
    what: 'Discussion threads, with their size and popularity. One topic holds many posts.',
    how: 'Straight from stored community threads — counts, views and likes as reported by the forum.',
    fresh: 'Live.',
    links: ['totalPosts'],
  },
  postsTable: {
    title: 'Posts',
    what: 'Individual messages, each tagged with the AI’s priority and mood reading and how sure it was.',
    how: 'Stored posts joined to their AI labels. Confidence under about 60% is worth a second look.',
    fresh: 'Live.',
    links: ['totalPosts', 'highPriority', 'modelConfidence'],
  },

  /* ---- Insight detail --------------------------------------------------- */
  insightBody: {
    title: 'What the assistant found',
    what: 'The AI’s write-up of the problem, in its own words.',
    how: 'Generated from the grouped posts behind this insight, not hand-written.',
    fresh: 'Rebuilt overnight.',
    links: ['activePainPoints', 'modelConfidence'],
  },
  insightEvidence: {
    title: 'Evidence',
    what: 'The actual quotes the conclusion rests on. If the write-up looks wrong, check these first.',
    how: 'Each quote keeps a link back to the post it came from.',
    fresh: 'Rebuilt overnight.',
    links: ['totalPosts'],
  },
  insightRelationships: {
    title: 'Relationships',
    what: 'Other things this problem is tied to, with a bar showing how strong each tie is.',
    how: 'Pairs the AI saw appearing together often in the posts behind this insight.',
    fresh: 'Rebuilt overnight.',
    links: ['activePainPoints'],
  },

  /* ---- Admin ------------------------------------------------------------ */
  adminLogs: {
    title: 'System logs',
    what: 'The running diary of the software itself. Red "Error" lines are where to start when something misbehaves.',
    how: 'Streamed from the API and the background worker. Click a line to see the full record.',
    fresh: 'Refreshes every 10 seconds.',
  },
  adminApiRate: {
    title: 'API request rate',
    what: 'How hard the system is being used, and how much of that is failing. Flat blue line, quiet day.',
    how: 'Requests per second over the last 30 minutes; the salmon line counts server errors only.',
    fresh: 'Refreshes every 30 seconds.',
  },
  adminTraffic: {
    title: 'Traffic (5m)',
    what: 'Requests per second right now, averaged over the last five minutes.',
    how: 'Summed across every API endpoint.',
    fresh: 'Refreshes every 30 seconds.',
  },
  adminErrorRate: {
    title: 'Error rate (5m)',
    what: 'Failures per second right now. Anything steadily above zero deserves a look at the logs.',
    how: 'Counts only server-side failures (HTTP 5xx), averaged over five minutes.',
    fresh: 'Refreshes every 30 seconds.',
  },
  adminPipeline: {
    title: 'Pipeline history',
    what: 'Every run of the collect-and-analyse job, and whether it finished. Like a delivery-tracking history.',
    how: 'One row per run, with what started it and how long it took.',
    fresh: 'Refreshes every 15 seconds.',
  },
  adminAudit: {
    title: 'Audit log',
    what: 'A tamper-evident record of who did what — manual runs, setting changes, access.',
    how: 'Security-relevant events only. Routine chatter stays in System logs.',
    fresh: 'Live.',
  },
}

/**
 * Hub-and-spoke graph for the info panel: the metric you asked about sits in
 * the middle (type `focus`, drawn unlabelled — the panel heading already names
 * it) with its related metrics on a ring around it.
 */
export function buildGraph(centerKey) {
  const info = METRIC_INFO[centerKey]
  if (!info?.links?.length) return { nodes: [], links: [] }

  const nodes = [{ id: centerKey, type: 'focus', value: info.title, weight: 100 }]
  const links = []

  info.links.forEach((linkKey) => {
    const linkInfo = METRIC_INFO[linkKey]
    if (linkInfo) {
      nodes.push({ id: linkKey, type: 'insight', value: linkInfo.title, weight: 50 })
      links.push({
        source: { id: centerKey },
        target: { id: linkKey },
        relation: 'related',
        strength: 0.8,
      })
    }
  })

  return { nodes, links }
}
