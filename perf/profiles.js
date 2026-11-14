// Load profiles and thresholds for perf/fanwire.js (PERF-001, perf/README.md).
//
// The absolute thresholds are deliberately generous: a local number measures
// the application and database code paths on this machine, not production
// latency. The real gate is perf_compare.py's comparison with the previous
// run on the same machine; these only catch something badly broken.

// Every endpoint tag fanwire.js sends. A threshold per tag is what makes k6
// write the `http_req_duration{endpoint:<name>}` submetric perf_compare.py
// reads, so a new scenario must be added here too.
export const ENDPOINTS = [
  'feed',
  'game',
  'search_posts',
  'search_accounts',
  'profile',
  'post_create',
];

const P95_MS = 500;
const P99_MS = 1000;
const MAX_FAILED_RATE = 0.01;

const PROFILES = {
  // A quick end-to-end check that every path works: one VU for a minute.
  smoke: {
    scenarios: {
      smoke: { executor: 'constant-vus', vus: 1, duration: '1m' },
    },
  },
  // Steady, moderate concurrency: the profile to compare before a deploy.
  load: {
    scenarios: {
      load: { executor: 'constant-vus', vus: 20, duration: '3m' },
    },
  },
  // Ramping until it breaks: aborted as soon as http_req_failed crosses its
  // limit (abortOnFail below), so a collapse ends the run rather than
  // hammering a dead backend. Stays under the 300 minted tokens.
  stress: {
    scenarios: {
      stress: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: '1m', target: 25 },
          { duration: '1m', target: 50 },
          { duration: '1m', target: 100 },
          { duration: '1m', target: 150 },
          { duration: '30s', target: 0 },
        ],
        gracefulRampDown: '10s',
      },
    },
    abortOnFail: true,
  },
};

export function profileName() {
  const name = __ENV.PROFILE || 'smoke';
  if (!PROFILES[name]) {
    throw new Error(`unknown PROFILE ${name}; use one of ${Object.keys(PROFILES).join(', ')}`);
  }
  return name;
}

export function optionsFor(name) {
  const profile = PROFILES[name];
  const thresholds = {
    http_req_failed: [
      profile.abortOnFail
        ? { threshold: `rate<${MAX_FAILED_RATE}`, abortOnFail: true, delayAbortEval: '15s' }
        : `rate<${MAX_FAILED_RATE}`,
    ],
  };
  for (const endpoint of ENDPOINTS) {
    thresholds[`http_req_duration{endpoint:${endpoint}}`] = [`p(95)<${P95_MS}`, `p(99)<${P99_MS}`];
    // Every endpoint must actually be exercised: a scenario that silently
    // stops sending requests fails the run instead of passing with no data.
    thresholds[`http_reqs{endpoint:${endpoint}}`] = ['count>0'];
  }
  return {
    scenarios: profile.scenarios,
    thresholds,
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    // setup() discovers seeded ids over a few requests; give it room on a
    // cold backend.
    setupTimeout: '60s',
  };
}
