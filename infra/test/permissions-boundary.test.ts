/**
 * The gate for `infra/iam/fanwire-role-boundary-policy.json` -- the
 * permissions boundary every role this app creates must carry.
 *
 * `cfn-exec-role` lets a template create `Fanwire-*` roles and write their
 * inline policies, and IAM has no condition key for what an inline policy
 * says. Without a boundary, a template that gives a role `*:*` hands admin to
 * whatever code runs as it. The boundary is the ceiling that holds whatever a
 * template writes, so this test pins three things:
 *
 *   1. Attachment. Every `AWS::IAM::Role` in every synthesized mode carries
 *      `FanwireRoleBoundary` (via `@aws-cdk/core:permissionsBoundary` in
 *      cdk.json). `cfn-exec-role` refuses to create one without it.
 *   2. Coverage. Every action any role is granted is inside the boundary. A
 *      grant outside it would deploy cleanly and then fail at runtime with
 *      AccessDenied, so it fails here instead -- extend the boundary in the
 *      same PR, and roll the new version out before the deploy.
 *   3. The ceiling itself. Exact actions only (no `service:*`, no `*`), and
 *      nothing in IAM, STS or Organizations, so no role can reach another
 *      role's permissions or touch the boundary.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DOMAIN_MODES, DOMAIN_MODES_DEPLOYING, cleanupFrontendDist, ensureFrontendDist, synthFanwire, CfnResource } from './helpers';

const BOUNDARY_PATH = path.resolve(__dirname, '..', 'iam', 'fanwire-role-boundary-policy.json');
const BOUNDARY_NAME = 'FanwireRoleBoundary';

/** What AWS's AWSLambdaBasicExecutionRole grants; templates attach it by ARN. */
const LAMBDA_BASIC_ACTIONS = ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'];

const MODES: Record<string, Record<string, unknown>> = {
  ...DOMAIN_MODES,
  ...Object.fromEntries(
    Object.entries(DOMAIN_MODES_DEPLOYING).map(([mode, overrides]) => [`${mode}, deployFrontend`, overrides]),
  ),
  // Email is off in cdk.json; keep the SES grant path under the boundary too.
  ...Object.fromEntries(
    Object.entries(DOMAIN_MODES)
      .filter(([mode]) => mode !== 'no domain')
      .map(([mode, overrides]) => [`${mode}, sendEmailNotifications`, { ...overrides, sendEmailNotifications: true }]),
  ),
};

interface Statement {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
  Condition?: unknown;
}

const asList = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function loadBoundary(): { Version: string; Statement: Statement[] } {
  return JSON.parse(fs.readFileSync(BOUNDARY_PATH, 'utf-8'));
}

const boundaryActions = (): string[] => loadBoundary().Statement.flatMap((s) => asList(s.Action));

/**
 * True if the boundary allows `action`. A granted action may itself be a
 * pattern (`s3:GetObject*`); it is covered only by the same string, or by a
 * boundary pattern that matches it literally.
 */
function covered(action: string): boolean {
  return boundaryActions().some((b) => {
    if (b === action) return true;
    const re = new RegExp(`^${b.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return re.test(action);
  });
}

beforeAll(() => {
  ensureFrontendDist();
});
afterAll(() => {
  cleanupFrontendDist();
});

/** Every role in a mode, with every action granted to it. */
function rolesAndGrants(overrides: Record<string, unknown>): Array<{ role: string; res: CfnResource; actions: string[] }> {
  const synth = synthFanwire(overrides);
  const out: Array<{ role: string; res: CfnResource; actions: string[] }> = [];
  for (const stack of synth.stackNames()) {
    const resources = (synth.json(stack).Resources ?? {}) as Record<string, CfnResource>;
    const grants = new Map<string, Set<string>>();
    const add = (roleId: string, doc: { Statement: Array<{ Action: string | string[] }> }) => {
      const set = grants.get(roleId) ?? new Set<string>();
      for (const st of doc.Statement) asList(st.Action).forEach((a) => set.add(a));
      grants.set(roleId, set);
    };
    for (const [id, res] of Object.entries(resources)) {
      if (res.Type !== 'AWS::IAM::Role') continue;
      for (const p of (res.Properties?.Policies as Array<{ PolicyDocument: never }>) ?? []) add(id, p.PolicyDocument);
      for (const arn of (res.Properties?.ManagedPolicyArns as unknown[]) ?? []) {
        const s = JSON.stringify(arn);
        if (!s.includes('AWSLambdaBasicExecutionRole')) throw new Error(`${stack}/${id}: unexpected managed policy ${s}`);
        add(id, { Statement: [{ Action: LAMBDA_BASIC_ACTIONS }] });
      }
    }
    for (const res of Object.values(resources)) {
      if (res.Type !== 'AWS::IAM::Policy') continue;
      for (const ref of (res.Properties?.Roles as Array<{ Ref?: string }>) ?? []) {
        if (ref.Ref) add(ref.Ref, res.Properties?.PolicyDocument as never);
      }
    }
    for (const [id, res] of Object.entries(resources)) {
      if (res.Type === 'AWS::IAM::Role') out.push({ role: `${stack}/${id}`, res, actions: [...(grants.get(id) ?? [])] });
    }
  }
  return out;
}

describe('permissions boundary: the policy', () => {
  test('is a valid policy of Allow statements on every resource', () => {
    const policy = loadBoundary();
    expect(policy.Version).toBe('2012-10-17');
    expect(policy.Statement.length).toBeGreaterThan(0);
    for (const s of policy.Statement) {
      expect(s.Effect).toBe('Allow');
      expect(asList(s.Resource)).toEqual(['*']);
      expect(s.Condition).toBeUndefined();
    }
  });

  test('names exact actions, never a whole service', () => {
    for (const a of boundaryActions()) {
      expect(a).not.toBe('*');
      expect(a).not.toMatch(/:\*$/);
    }
  });

  test('grants nothing in IAM, STS or Organizations', () => {
    for (const a of boundaryActions()) expect(a).not.toMatch(/^(iam|sts|organizations):/);
  });

  test('fits the managed-policy size limit (6,144 non-whitespace characters)', () => {
    expect(fs.readFileSync(BOUNDARY_PATH, 'utf-8').replace(/\s/g, '').length).toBeLessThanOrEqual(6144);
  });
});

describe.each(Object.entries(MODES))('permissions boundary (%s)', (_mode, overrides) => {
  test('every role carries FanwireRoleBoundary', () => {
    const roles = rolesAndGrants(overrides);
    expect(roles.length).toBeGreaterThan(0);
    const missing = roles
      .filter(({ res }) => !JSON.stringify(res.Properties?.PermissionsBoundary ?? '').includes(`:policy/${BOUNDARY_NAME}`))
      .map(({ role }) => role);
    expect(missing).toEqual([]);
  });

  test('every action a role is granted is inside the boundary', () => {
    const outside: string[] = [];
    for (const { role, actions } of rolesAndGrants(overrides)) {
      for (const a of actions) if (!covered(a)) outside.push(`${role}: ${a}`);
    }
    expect(outside.sort()).toEqual([]);
  });
});
