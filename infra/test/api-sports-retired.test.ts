/**
 * INFRA-005: API-SPORTS left resources behind in Fanwire-Data (the idempotency
 * and live-score cache tables, the API-SPORTS secret) and Fanwire-Messaging (the
 * ingestion-retry queue and its DLQ), kept only for their exports until
 * Fanwire-App stopped importing them (EVENTS-003). They are gone. This sweeps
 * every stack in every synth mode, so none comes back under another stack or
 * mode: no resource, no output and no Fn::ImportValue names them.
 */
import {
  DOMAIN_MODES,
  DOMAIN_MODES_DEPLOYING,
  cleanupFrontendDist,
  ensureFrontendDist,
  synthFanwire,
} from './helpers';

const RETIRED = ['IdempotencyTable', 'LiveScoreCache', 'ApiSports', 'IngestionRetry'] as const;

/** Every mode `cdk synth` supports, with and without the frontend deployment. */
const SYNTH_MODES: Record<string, Record<string, unknown>> = {
  ...DOMAIN_MODES,
  ...Object.fromEntries(
    Object.entries(DOMAIN_MODES_DEPLOYING).map(([mode, overrides]) => [`${mode}, deployFrontend`, overrides]),
  ),
};

beforeAll(() => {
  ensureFrontendDist();
});
afterAll(() => {
  cleanupFrontendDist();
});

const named = (text: string) => RETIRED.filter((fragment) => text.includes(fragment));

/** Every value of an `Fn::ImportValue` anywhere in `node`, as JSON text. */
function importValues(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) importValues(item, out);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'Fn::ImportValue') out.push(JSON.stringify(value));
      importValues(value, out);
    }
  }
  return out;
}

describe.each(Object.entries(SYNTH_MODES))('API-SPORTS resources are gone (%s)', (_mode, overrides) => {
  const synth = () => synthFanwire(overrides);

  test('all eight stacks synthesize', () => {
    expect(synth().stackNames()).toHaveLength(8);
  });

  test('no resource logical id names a retired resource', () => {
    const offenders = synth()
      .stackNames()
      .flatMap((stack) => Object.keys(synth().json(stack).Resources ?? {}).map((id) => `${stack}/${id}`))
      .filter((id) => named(id).length > 0);
    expect(offenders).toEqual([]);
  });

  test('no output names a retired resource, by id, value or export name', () => {
    const offenders = synth()
      .stackNames()
      .flatMap((stack) =>
        Object.entries(synth().json(stack).Outputs ?? {}).map(([id, output]) => `${stack}/${id} ${JSON.stringify(output)}`),
      )
      .filter((text) => named(text).length > 0);
    expect(offenders).toEqual([]);
  });

  test('no template imports a retired export', () => {
    const offenders = synth()
      .stackNames()
      .flatMap((stack) => importValues(synth().json(stack)).map((value) => `${stack} ${value}`))
      .filter((text) => named(text).length > 0);
    expect(offenders).toEqual([]);
  });
});
