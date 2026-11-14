/**
 * INFRA-002: the frontend bucket gets a deployment path.
 *
 * `CdnStack` serves `frontendBucket` through CloudFront but nothing ever puts
 * a file in it, so a deploy produces a correct, empty site. The fix is an
 * `aws-s3-deployment` `BucketDeployment` of `frontend/dist`, gated behind a
 * CDK context flag that defaults OFF -- `frontend/dist` is gitignored, and CI
 * synthesizes on a clean checkout where `Source.asset()` would throw.
 *
 * Everything here asserts against the synthesized template, never the
 * construct objects.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { loadConfig } from '../lib/config';
import {
  DOMAIN_MODES,
  DOMAIN_MODES_DEPLOYING,
  FRONTEND_DIST,
  STACK_NAMES,
  cdkJsonContext,
  cleanupFrontendDist,
  ensureFrontendDist,
  resourcesOfType,
  synthFanwire,
  CfnResource,
} from './helpers';

const DEPLOYMENT_TYPE = 'Custom::CDKBucketDeployment';

const cdn = (overrides: Record<string, unknown> = {}) => synthFanwire(overrides).json(STACK_NAMES.cdn);
const deployments = (overrides: Record<string, unknown> = {}) =>
  resourcesOfType(cdn(overrides), DEPLOYMENT_TYPE);

/** The single deployment resource, or a failed expectation naming what was found instead. */
function theDeployment(overrides: Record<string, unknown>): CfnResource {
  const found = deployments(overrides);
  expect(Object.keys(found)).toHaveLength(1);
  return Object.values(found)[0]!;
}

beforeAll(() => {
  ensureFrontendDist();
});
afterAll(() => {
  cleanupFrontendDist();
});

describe('the deployFrontend flag is off unless asked for (criterion 1)', () => {
  test('cdk.json does not carry deployFrontend, so a bare `cdk synth` leaves it unset', () => {
    // The whole design rests on this: CI synthesizes with no frontend build,
    // and `Source.asset('frontend/dist')` would throw at synth time.
    expect(Object.keys(cdkJsonContext())).not.toContain('deployFrontend');
  });

  test('with the context key unset, Fanwire-Cdn has no bucket deployment', () => {
    expect(Object.keys(deployments({}))).toEqual([]);
  });

  test.each(Object.entries(DOMAIN_MODES))(
    'with the context key unset (%s): no bucket deployment',
    (_mode, overrides) => {
      expect(overrides.deployFrontend).toBeUndefined();
      expect(Object.keys(deployments(overrides))).toEqual([]);
    },
  );

  test.each(Object.entries(DOMAIN_MODES))(
    'with the context key unset (%s): still synthesizes clean, no lookups, no errors',
    (_mode, overrides) => {
      const synth = synthFanwire(overrides);
      expect(synth.assembly.manifest.missing ?? []).toEqual([]);
      const errors = synth.assembly.stacks.flatMap((s) =>
        s.messages.filter((m) => m.level === 'error').map((m) => `${s.stackName} ${m.id}: ${String(m.entry.data)}`),
      );
      expect(errors).toEqual([]);
    },
  );

  test('no bucket deployment resource exists in ANY stack while the flag is off', () => {
    const synth = synthFanwire({});
    const found = synth
      .stackNames()
      .flatMap((name) => Object.keys(resourcesOfType(synth.json(name), DEPLOYMENT_TYPE)).map((id) => `${name}/${id}`));
    expect(found).toEqual([]);
  });
});

describe.each(Object.entries(DOMAIN_MODES_DEPLOYING))('deployFrontend=true (%s)', (_mode, overrides) => {
  test('exactly one bucket deployment in Fanwire-Cdn (criterion 2)', () => {
    expect(Object.keys(deployments(overrides))).toHaveLength(1);
  });

  test('it deploys the built SPA, not an empty asset (criterion 2)', () => {
    const props = theDeployment(overrides).Properties ?? {};
    expect(props.SourceObjectKeys).toEqual([expect.stringMatching(/^[0-9a-f]{64}\.zip$/)]);
    expect(props.SourceBucketNames).toEqual([expect.stringContaining('cdk-')]);
  });

  test('its destination is the frontend bucket, never the public-media bucket (criterion 3)', () => {
    const props = theDeployment(overrides).Properties ?? {};
    // The frontend bucket is imported into CdnStack, so the destination name
    // renders as an Fn::Select/Fn::Split over Fanwire-Storage's exported ARN
    // rather than a Ref to a local bucket.
    const destination = JSON.stringify(props.DestinationBucketName);
    expect(destination).toContain('FrontendBucket');
    expect(destination).not.toContain('PublicMediaBucket');
    expect(destination).not.toContain('QuarantineBucket');
  });

  test('it invalidates this distribution at /* so a redeploy is not served from cache (criterion 4)', () => {
    const props = theDeployment(overrides).Properties ?? {};
    expect(props.DistributionPaths).toEqual(['/*']);
    const distributionIds = Object.keys(resourcesOfType(cdn(overrides), 'AWS::CloudFront::Distribution'));
    expect(distributionIds).toHaveLength(1);
    expect(props.DistributionId).toEqual({ Ref: distributionIds[0] });
  });

  test('it still synthesizes clean: no lookups, no error annotations', () => {
    const synth = synthFanwire(overrides);
    expect(synth.assembly.manifest.missing ?? []).toEqual([]);
    const errors = synth.assembly.stacks.flatMap((s) =>
      s.messages.filter((m) => m.level === 'error').map((m) => `${s.stackName} ${m.id}: ${String(m.entry.data)}`),
    );
    expect(errors).toEqual([]);
  });
});

describe('loadConfig exposes the flag (criterion 5)', () => {
  const configWith = (overrides: Record<string, unknown>) =>
    loadConfig(new cdk.App({ context: { ...cdkJsonContext(), ...overrides } }).node);

  test('absent means false, and it is a boolean, not a truthy string', () => {
    const value: unknown = configWith({ deployFrontend: undefined }).deployFrontend;
    expect(typeof value).toBe('boolean');
    expect(value).toBe(false);
  });

  test('a real boolean true is accepted', () => {
    expect(configWith({ deployFrontend: true }).deployFrontend).toBe(true);
  });

  test('`-c deployFrontend=true` arrives as the string "true" and must still turn it on', () => {
    // This is the documented deploy command; a boolean-only reader would make
    // it silently do nothing.
    expect(configWith({ deployFrontend: 'true' }).deployFrontend).toBe(true);
  });

  test.each([['false'], [''], ['0'], ['no']])('%p does not turn it on', (raw) => {
    expect(configWith({ deployFrontend: raw }).deployFrontend).toBe(false);
  });
});

describe('the frontend/dist fixture', () => {
  test('exists while these tests run (otherwise Source.asset would throw at synth)', () => {
    expect(FRONTEND_DIST).toBe(path.resolve(__dirname, '..', '..', 'frontend', 'dist'));
    expect(fs.existsSync(FRONTEND_DIST)).toBe(true);
    expect(fs.readdirSync(FRONTEND_DIST).length).toBeGreaterThan(0);
  });
});
