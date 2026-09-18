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
 * Synthesizes the whole app with cdk.json's context plus `overrides`.
 * Cached per override set — synthesis stages the Lambda image context, so
 * doing it once per mode keeps the suite quick.
 */
export function synthFanwire(overrides: Record<string, unknown> = {}): Synthesized {
  const key = JSON.stringify(overrides);
  const hit = cache.get(key);
  if (hit) return hit;

  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanwire-cdk-test-'));
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

/** The three domain modes `cdk synth` must support. */
export const DOMAIN_MODES: Record<string, Record<string, unknown>> = {
  'no domain': { domainName: '', hostedZoneId: '' },
  'domain without hosted zone': { domainName: 'fanwire.daviddems.ca', hostedZoneId: '' },
  'domain with hosted zone': {
    domainName: 'fanwire.daviddems.ca',
    hostedZoneId: 'Z0123456789ABCDEFGHIJ',
    hostedZoneName: 'daviddems.ca',
  },
};
