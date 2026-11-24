/**
 * Every Python function the app defines runs the one Python the app ships.
 *
 * The API and its workers are container images, and Renovate's `python runtime`
 * group moves their base image (`public.ecr.aws/lambda/python`). The two small
 * inline functions are zip functions whose runtime Renovate cannot see, so a
 * runtime bump that forgets them leaves them behind silently (INFRA-006).
 *
 * CDK also synthesizes Lambdas of its own: the cross-region export writer and
 * reader (Node) and, when the frontend is deployed, `BucketDeployment`'s handler
 * (Python). Their runtimes are chosen by `aws-cdk-lib`, not by this app, so they
 * are not held to the app's Python. They are pinned by name instead, so nothing
 * of ours can hide among them.
 */
import {
  DOMAIN_MODES,
  DOMAIN_MODES_DEPLOYING,
  cleanupFrontendDist,
  ensureFrontendDist,
  resourcesOfType,
  synthFanwire,
} from './helpers';

const APP_PYTHON = 'python3.15';

/** The zip functions this app writes itself, by logical-id prefix. */
const APP_ZIP_FUNCTIONS = ['OriginVerifyAuthorizer', 'PreSignUpTrigger'];

/** CDK's own handlers, by logical-id prefix. Their runtime is aws-cdk-lib's. */
const CDK_OWNED = [
  'CustomCrossRegionExportWriterCustomResourceProviderHandler',
  'CustomCrossRegionExportReaderCustomResourceProviderHandler',
  'CustomCDKBucketDeployment',
];

type Fn = { stack: string; id: string; runtime: unknown; packageType: unknown };

function functionsIn(overrides: Record<string, unknown>): Fn[] {
  const synth = synthFanwire(overrides);
  return synth.stackNames().flatMap((stack) =>
    Object.entries(resourcesOfType(synth.json(stack), 'AWS::Lambda::Function')).map(([id, r]) => ({
      stack,
      id,
      runtime: r.Properties?.Runtime,
      packageType: r.Properties?.PackageType,
    })),
  );
}

const startsWithAny = (id: string, prefixes: string[]) => prefixes.some((p) => id.startsWith(p));

const MODES: [string, Record<string, unknown>][] = [
  ...Object.entries(DOMAIN_MODES),
  ...Object.entries(DOMAIN_MODES_DEPLOYING).map(
    ([mode, o]): [string, Record<string, unknown>] => [`${mode}, frontend deployed`, o],
  ),
];

beforeAll(() => {
  ensureFrontendDist();
});

afterAll(() => {
  cleanupFrontendDist();
});

describe.each(MODES)('Lambda runtimes (%s)', (_mode, overrides) => {
  test('every function is an image, one of our zip functions, or one of CDK\'s own handlers', () => {
    const unknown = functionsIn(overrides)
      .filter((f) => f.packageType !== 'Image')
      .filter((f) => !startsWithAny(f.id, APP_ZIP_FUNCTIONS) && !startsWithAny(f.id, CDK_OWNED))
      .map((f) => `${f.stack}/${f.id} (${String(f.runtime)})`);
    expect(unknown).toEqual([]);
  });

  test(`our zip functions run ${APP_PYTHON}`, () => {
    const ours = functionsIn(overrides).filter((f) => startsWithAny(f.id, APP_ZIP_FUNCTIONS));
    expect(ours.map((f) => f.id.replace(/[0-9A-F]{8}$/, '')).sort()).toEqual([...APP_ZIP_FUNCTIONS].sort());
    for (const f of ours) expect(`${f.stack}/${f.id} ${String(f.runtime)}`).toBe(`${f.stack}/${f.id} ${APP_PYTHON}`);
  });

  test('image functions name no runtime: the image carries it', () => {
    const images = functionsIn(overrides).filter((f) => f.packageType === 'Image');
    expect(images.length).toBeGreaterThan(0);
    for (const f of images) expect(f.runtime).toBeUndefined();
  });
});
