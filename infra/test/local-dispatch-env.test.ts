import { DOMAIN_MODES, resourcesOfType, synthFanwire, CfnResource } from './helpers';

/**
 * NOTIFICATIONS-001: with ENVIRONMENT exactly "development" and no
 * POST_EVENT_BUS_NAME, app.dependencies.get_event_bus delivers domain events
 * in process. app.settings.Settings refuses that value inside a Lambda or
 * beside a bus name. This pins the other half of that fail-closed pair as a
 * property of the synthesized templates: no deployed Lambda function sets
 * ENVIRONMENT to anything containing "development".
 *
 * It passes today, since no stack sets the variable. It is a guard against a
 * later change, not a test of new code.
 */

const variablesOf = (f: CfnResource): Record<string, unknown> =>
  (f.Properties?.Environment as { Variables?: Record<string, unknown> } | undefined)?.Variables ?? {};

const SYNTH_CASES: Record<string, Record<string, unknown>> = { 'cdk.json defaults': {}, ...DOMAIN_MODES };

describe.each(Object.entries(SYNTH_CASES))('local dispatch never deployed (%s)', (_mode, overrides) => {
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

  test('no Lambda function sets ENVIRONMENT to anything containing "development"', () => {
    const offenders = functions()
      .filter(([, , f]) => JSON.stringify(variablesOf(f).ENVIRONMENT ?? null).toLowerCase().includes('development'))
      .map(([stack, id]) => `${stack}/${id}`);
    expect(offenders).toEqual([]);
  });
});
