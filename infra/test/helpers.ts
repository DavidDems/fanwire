import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as cxapi from 'aws-cdk-lib/cx-api';
import { buildFanwire, STACK_NAMES } from '../lib/app';

export { STACK_NAMES };

/** cdk.json's context block — the same defaults `cdk synth` uses. */
export function cdkJsonContext(): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'cdk.json'), 'utf8');
  return JSON.parse(raw).context as Record<string, unknown>;
}

export interface Synthesized {
  readonly assembly: cxapi.CloudAssembly;
  template(stackName: string): Template;
  /** Raw template JSON for a stack. */
  json(stackName: string): { Resources?: Record<string, CfnResource>; Outputs?: Record<string, unknown> };
  stackNames(): string[];
}

export interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
  [key: string]: unknown;
}

const cache = new Map<string, Synthesized>();

/**
 * Every synth copies the backend image context and the awscli layer into its
 * outdir (~50 MB with `deployFrontend`), so outdirs left in the OS temp dir
 * fill the disk within a few dozen runs -- 612 of them hit ENOSPC on
 * 2026-09-30. Removed after each test file: jest gives every file its own
 * module registry (so its own `cache`), and kills workers without firing
 * `process.on('exit')`.
 */
const outdirs: string[] = [];
afterAll(() => {
  for (const dir of outdirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  cache.clear();
});

/**
 * Synthesizes the whole app with cdk.json's context plus `overrides`.
 * Cached per override set — synthesis stages the Lambda image context, so
 * doing it once per mode keeps the suite quick.
 */
export function synthFanwire(overrides: Record<string, unknown> = {}): Synthesized {
  const key = JSON.stringify(overrides);
  const hit = cache.get(key);
  if (hit) return hit;

  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanwire-cdk-test-'));
  outdirs.push(outdir);
  const app = new cdk.App({ outdir, context: { ...cdkJsonContext(), ...overrides } });
  buildFanwire(app);
  const assembly = app.synth();

  const result: Synthesized = {
    assembly,
    template: (name) => Template.fromJSON(assembly.getStackByName(name).template),
    json: (name) => assembly.getStackByName(name).template,
    stackNames: () => assembly.stacks.map((s) => s.stackName),
  };
  cache.set(key, result);
  return result;
}

/** Every resource of `type` in a template, keyed by logical id. */
export function resourcesOfType(
  tpl: { Resources?: Record<string, CfnResource> },
  type: string,
): Record<string, CfnResource> {
  const out: Record<string, CfnResource> = {};
  for (const [id, r] of Object.entries(tpl.Resources ?? {})) {
    if (r.Type === type) out[id] = r;
  }
  return out;
}

/**
 * The three domain modes `cdk synth` must support.
 *
 * Every mode sets all three keys explicitly. These are merged *over* cdk.json's
 * context, so a key a mode leaves out keeps whatever the real deployment
 * config happens to say — and a mode called "no domain" that silently inherits
 * a live `hostedZoneName` is not testing the mode it names. That is not
 * hypothetical: the day `hostedZoneName` was filled in for the real zone, both
 * zone-less modes started failing `loadConfig`'s "hostedZoneName requires
 * hostedZoneId" check, because they had only ever cleared the id.
 */
export const DOMAIN_MODES: Record<string, Record<string, unknown>> = {
  'no domain': { domainName: '', hostedZoneId: '', hostedZoneName: '', deployFrontend: undefined },
  'domain without hosted zone': {
    domainName: 'fanwire.daviddems.com',
    hostedZoneId: '',
    hostedZoneName: '',
    deployFrontend: undefined,
  },
  'domain with hosted zone': {
    domainName: 'fanwire.daviddems.com',
    hostedZoneId: 'Z0123456789ABCDEFGHIJ',
    hostedZoneName: 'daviddems.com',
    deployFrontend: undefined,
  },
};

/**
 * `deployFrontend: undefined` above is deliberate and is *not* the same as
 * leaving the key out.
 *
 * These objects are spread over `cdk.json`'s context, and an own property
 * whose value is `undefined` still wins the spread -- so the key is pinned
 * explicitly (the `hostedZoneName` lesson) while `node.tryGetContext` still
 * reports it as genuinely absent, which is the state criterion 1 is about.
 * Every existing suite therefore keeps synthesizing with the flag unset even
 * if `cdk.json` ever gains a real `deployFrontend` value.
 */

/** The same three domain modes, with the frontend deployment flag switched on. */
export const DOMAIN_MODES_DEPLOYING: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(DOMAIN_MODES).map(([mode, overrides]) => [mode, { ...overrides, deployFrontend: true }]),
);

/**
 * `frontend/dist` is a build output: gitignored (`.gitignore:17`) and absent on
 * a clean CI checkout. `s3deploy.Source.asset()` resolves its source at synth
 * time and throws if the directory is missing, so any test that synthesizes
 * with `deployFrontend` on has to create it first.
 *
 * Cleanup is deliberately timid, because a human may have a real
 * `npm run build` sitting there. Jest runs test files in parallel worker
 * processes, and the worker that leaves last is not necessarily the one that
 * created the directory -- so "we created this" is recorded *in the directory*
 * (`.fanwire-test-owned`), not in a module variable. Each caller also drops a
 * pid-named marker while it needs the directory, and the tree is removed only
 * when it is ours, no marker is left, and nothing but our own placeholder is
 * inside.
 */
export const FRONTEND_DIST = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const DIST_MARKER_PREFIX = '.fanwire-test-marker-';
const DIST_OWNED = '.fanwire-test-owned';
const DIST_PLACEHOLDER = 'index.html';
let distMarker: string | undefined;

/** Creates `frontend/dist` if it is missing. Returns its absolute path. */
export function ensureFrontendDist(): string {
  if (distMarker) return FRONTEND_DIST;
  if (!fs.existsSync(FRONTEND_DIST)) {
    fs.mkdirSync(FRONTEND_DIST, { recursive: true });
    // An empty directory is not a usable asset source on every platform.
    fs.writeFileSync(
      path.join(FRONTEND_DIST, DIST_PLACEHOLDER),
      '<!doctype html><title>fanwire infra test placeholder</title>\n',
    );
    fs.writeFileSync(path.join(FRONTEND_DIST, DIST_OWNED), 'created by infra/test; safe to delete\n');
  }
  distMarker = path.join(FRONTEND_DIST, `${DIST_MARKER_PREFIX}${process.pid}`);
  fs.writeFileSync(distMarker, 'infra/test is synthesizing against this directory\n');
  return FRONTEND_DIST;
}

/** Undoes `ensureFrontendDist` -- and only ever that. Never deletes a real build. */
export function cleanupFrontendDist(): void {
  if (!distMarker) return;
  fs.rmSync(distMarker, { force: true });
  distMarker = undefined;
  // A directory we did not create is never ours to remove.
  if (!fs.existsSync(path.join(FRONTEND_DIST, DIST_OWNED))) return;
  const left = fs.readdirSync(FRONTEND_DIST);
  // Another worker is still synthesizing against it, or a real build appeared.
  if (left.some((name) => name.startsWith(DIST_MARKER_PREFIX))) return;
  if (left.some((name) => name !== DIST_PLACEHOLDER && name !== DIST_OWNED)) return;
  fs.rmSync(FRONTEND_DIST, { recursive: true, force: true });
}
