// The local load test (PERF-001, perf/README.md). Run by perf/run.ps1 in the
// compose `k6` service:  k6 run --env PROFILE=smoke|load|stress fanwire.js
//
// It only ever targets backend-perf (BASE_URL, set by docker-compose.yml to
// http://backend-perf:8001). Virtual users sign in with the ID tokens
// backend/scripts/mint_perf_tokens.py wrote to results/tokens.json; VU n uses
// token (n-1) mod N, i.e. it is perf-user-<((n-1) mod N) + 1>.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { ENDPOINTS, optionsFor, profileName } from './profiles.js';

const PROFILE = profileName();
const BASE_URL = __ENV.BASE_URL || 'http://backend-perf:8001';

export const options = optionsFor(PROFILE);

// Read once in the init context and shared between VUs.
const TOKENS = new SharedArray('tokens', () => JSON.parse(open('./results/tokens.json')));

// The weighted mix, like real use: mostly reads, a small share of posting.
// Each VU walks this schedule in order, offset by its VU number, so every
// endpoint is hit in every run however short (a missing endpoint would fail
// the comparison with the baseline).
const WEIGHTS = {
  feed: 8,
  game: 4,
  profile: 3,
  search_posts: 2,
  search_accounts: 1,
  post_create: 2,
};
const SCHEDULE = Object.entries(WEIGHTS).flatMap(([name, weight]) => Array(weight).fill(name));

// Words the seed (backend/scripts/seed_perf.py VOCABULARY) builds post text from.
const WARMUP_ROUNDS = 10;
// Seconds between iterations. Short on purpose: the test measures latency
// under concurrency rather than modelling a person's reading time, and more
// samples per endpoint make the per-endpoint P95/P99 steadier.
const THINK_TIME = 0.1;

const SEARCH_WORDS = ['dunk', 'rebound', 'buzzer', 'defense', 'playoffs', 'rookie', 'overtime'];

// setup() runs as VU 0; it signs in as perf-user-1.
function authHeaders() {
  const token = TOKENS[Math.max(vu() - 1, 0) % TOKENS.length];
  return { Authorization: `Bearer ${token}` };
}

// Set during setup()'s warm-up, so its requests are tagged `warmup` and stay
// out of every endpoint's numbers.
let tagOverride = null;
// Counts this VU's posts, so post text is unique even within one iteration.
let postSequence = 0;
// The salt pick() adds; the warm-up advances it so it spreads over ids.
let salt = 0;

// __VU is 0 and __ITER undefined in setup(); read them through these.
function vu() {
  return typeof __VU === 'undefined' ? 0 : __VU;
}

function iteration() {
  return typeof __ITER === 'undefined' ? 0 : __ITER;
}

function tagFor(endpoint) {
  return tagOverride || endpoint;
}

function get(path, endpoint, expected = 200) {
  const response = http.get(`${BASE_URL}${path}`, {
    headers: authHeaders(),
    tags: { endpoint: tagFor(endpoint) },
  });
  check(response, { [`${endpoint} ${expected}`]: (r) => r.status === expected });
  return response;
}

function pick(list, offset) {
  return list[(vu() * 31 + iteration() * 7 + salt + offset) % list.length];
}

// Discover what the seed wrote rather than hardcoding ids: the seeded games
// are the only games in postgres-perf, and the perf users are found by name.
// Then warm the backend up (below SCENARIOS, which it uses).
export function setup() {
  const params = { tags: { endpoint: 'setup' } };
  const health = http.get(`${BASE_URL}/health`, params);
  if (health.status !== 200) {
    throw new Error(`backend-perf is not healthy: GET /health answered ${health.status}`);
  }

  const games = http.get(`${BASE_URL}/events/games?limit=200`, params);
  const gameIds = games.status === 200 ? games.json().map((g) => g.id) : [];

  const userIds = [];
  for (let offset = 0; offset < 150; offset += 50) {
    const page = http.get(`${BASE_URL}/search/accounts?q=perfuser&limit=50&offset=${offset}`, params);
    if (page.status !== 200) break;
    userIds.push(...page.json().items.map((u) => u.id));
  }

  if (gameIds.length === 0 || userIds.length === 0) {
    throw new Error(
      `no seeded data found (games: ${gameIds.length}, users: ${userIds.length}); ` +
        'did backend/scripts/seed_perf.py run?',
    );
  }
  const data = { gameIds, userIds };

  // Warm-up: a freshly started backend's first requests (connection pools,
  // imports, Postgres caches) are slower than the rest, and a run would
  // otherwise be compared partly on how cold it started.
  tagOverride = 'warmup';
  for (let round = 0; round < WARMUP_ROUNDS; round += 1) {
    for (const name of Object.keys(SCENARIOS)) {
      salt = round * 13;
      SCENARIOS[name](data);
    }
  }
  tagOverride = null;
  salt = 0;
  return data;
}

const SCENARIOS = {
  feed() {
    get('/feed?limit=20', 'feed');
  },
  game(data) {
    get(`/events/games/${pick(data.gameIds, 1)}`, 'game');
  },
  profile(data) {
    get(`/users/${pick(data.userIds, 2)}`, 'profile');
  },
  search_posts() {
    get(`/search/posts?q=${pick(SEARCH_WORDS, 3)}&limit=20`, 'search_posts');
  },
  search_accounts() {
    get(`/search/accounts?q=perfuser${((iteration() + salt) % 30) + 1}&limit=20`, 'search_accounts');
  },
  post_create(data) {
    // Unique per VU and iteration (DuplicateContentCheck refuses repeated
    // text from one author, and two VUs can share a token), and no link (the
    // spam scorer). Every other post mentions a game, like real use.
    postSequence += 1;
    const mention = postSequence % 2 === 0 ? ` #GameId${pick(data.gameIds, 4)}` : '';
    const text =
      `k6 ${PROFILE} vu ${vu()} iteration ${iteration()} post ${postSequence} at ${Date.now()}: ` +
      `what a ${pick(SEARCH_WORDS, 5)} tonight${mention}`;
    const response = http.post(`${BASE_URL}/posts`, JSON.stringify({ text }), {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      tags: { endpoint: tagFor('post_create') },
    });
    check(response, { 'post_create 201': (r) => r.status === 201 });
  },
};

export default function (data) {
  const name = SCHEDULE[(__ITER + __VU) % SCHEDULE.length];
  SCENARIOS[name](data);
  sleep(THINK_TIME);
}

function fmt(value) {
  return value === undefined ? '-' : value.toFixed(2);
}

function textSummary(data) {
  const lines = [`\nfanwire perf summary (${PROFILE})`, ''];
  lines.push(`${'endpoint'.padEnd(18)} ${'count'.padStart(7)} ${'p95 ms'.padStart(10)} ${'p99 ms'.padStart(10)}  thresholds`);
  for (const endpoint of ENDPOINTS) {
    const metric = data.metrics[`http_req_duration{endpoint:${endpoint}}`];
    const values = (metric && metric.values) || {};
    const count = data.metrics[`http_reqs{endpoint:${endpoint}}`];
    const failed = [metric, count].some(
      (m) => m && m.thresholds && Object.values(m.thresholds).some((t) => !t.ok),
    );
    lines.push(
      `${endpoint.padEnd(18)} ${String(count ? count.values.count : '-').padStart(7)} ` +
        `${fmt(values['p(95)']).padStart(10)} ${fmt(values['p(99)']).padStart(10)}  ` +
        `${failed ? 'FAIL' : 'ok'}`,
    );
  }
  const failedRate = data.metrics.http_req_failed;
  if (failedRate) {
    lines.push('', `http_req_failed rate: ${(failedRate.values.rate * 100).toFixed(2)}%`);
  }
  const checks = data.metrics.checks;
  if (checks) {
    lines.push(`checks passed: ${(checks.values.rate * 100).toFixed(2)}%`);
  }
  return `${lines.join('\n')}\n`;
}

// Written even when a threshold fails, so the run can still be compared.
export function handleSummary(data) {
  return {
    [`results/summary-${PROFILE}.json`]: JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}
