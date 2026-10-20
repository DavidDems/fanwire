import { DOMAIN_MODES, resourcesOfType, synthFanwire, CfnResource } from './helpers';

/**
 * PERF-001: the backend accepts ID tokens signed by a local test key only
 * when ENVIRONMENT is exactly "perf" and PERF_JWKS_PATH is set
 * (app.settings.Settings refuses the path anywhere else). This pins the
 * other half of that fail-closed pair as a property of the synthesized
 * templates: no deployed Lambda function sets PERF_JWKS_PATH at all, and
 * none sets ENVIRONMENT to "perf".
 *
 * It passes today, since no stack sets either variable. It is a guard against
 * a later change, not a test of new code.
 */

const variablesOf = (f: CfnResource): Record<string, unknown> =>
  (f.Properties?.Environment as { Variables?: Record<string, unknown> } | undefined)?.Variables ?? {};

const SYNTH_CASES: Record<string, Record<string, unknown>> = { 'cdk.json defaults': {}, ...DOMAIN_MODES };

describe.each(Object.entries(SYNTH_CASES))('perf variables never deployed (%s)', (_mode, overrides) => {
  const functions = (): [string, string, CfnResource][] => {
    const synth = synthFanwire(overrides);
    return synth
      .stackNames()
      .flatMap((stack) =>
        Object.entries(resourcesOfType(synth.json(stack), 'AWS::Lambda::Function')).map(
          ([id, f]) => [stack, id, f] as [string, string, CfnResource],
        ),
      );
  };

  test('the synthesized app has Lambda functions to check', () => {
    expect(functions().length).toBeGreaterThan(0);
  });

  test('no Lambda function sets PERF_JWKS_PATH', () => {
    const offenders = functions()
      .filter(([, , f]) => Object.prototype.hasOwnProperty.call(variablesOf(f), 'PERF_JWKS_PATH'))
      .map(([stack, id]) => `${stack}/${id}`);
    expect(offenders).toEqual([]);
  });

  test('no Lambda function sets ENVIRONMENT to "perf"', () => {
    const offenders = functions()
      .filter(([, , f]) => JSON.stringify(variablesOf(f).ENVIRONMENT ?? null).toLowerCase().includes('perf'))
      .map(([stack, id]) => `${stack}/${id}`);
    expect(offenders).toEqual([]);
  });
});
