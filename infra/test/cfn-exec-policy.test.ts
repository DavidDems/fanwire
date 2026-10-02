/**
 * The gate for `infra/iam/cdk-cfn-exec-role-policy.json` -- the policy that
 * replaces `AdministratorAccess` on `cdk-hnb659fds-cfn-exec-role-*` (both
 * regions), applied with `cdk bootstrap --cloudformation-execution-policies`.
 *
 * That role is not part of this app's templates, so `iam-policy.test.ts` never
 * sees it. It is scoped by *service*, not by action (infra/iam/README.md says
 * why), so this test does not try to prove least privilege. It pins two
 * things instead:
 *
 *   1. Coverage drift. Every AWS service a synthesized template creates
 *      resources in must be granted, and every service principal a template
 *      role trusts must be passable. A stack change that adds either fails
 *      here, in CI, rather than mid-deploy -- where the rollback would need
 *      the same missing permission.
 *   2. The IAM fence. `iam` is the one service whose wildcard turns a deploy
 *      credential into an escalation path, so its writes are an explicit
 *      allow-list, confined to `Fanwire-*` roles and instance profiles, with
 *      managed-policy attachment and PassRole each pinned by a condition. The
 *      `Fanwire-*` scope only holds while CloudFormation names every role
 *      `<StackName>-...`, so explicit role names and paths fail here too.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  DOMAIN_MODES,
  DOMAIN_MODES_DEPLOYING,
  STACK_NAMES,
  cleanupFrontendDist,
  ensureFrontendDist,
  synthFanwire,
  CfnResource,
} from './helpers';

const POLICY_PATH = path.resolve(__dirname, '..', 'iam', 'cdk-cfn-exec-role-policy.json');
const ACCOUNT = '294321867941';
const LAMBDA_BASIC = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';

/** CloudFormation resource-type namespace -> IAM service prefix. */
const TYPE_TO_IAM: Record<string, string> = {
  ApiGatewayV2: 'apigateway',
  CertificateManager: 'acm',
  CloudFront: 'cloudfront',
  Cognito: 'cognito-idp',
  DynamoDB: 'dynamodb',
  EC2: 'ec2',
  Events: 'events',
  GuardDuty: 'guardduty',
  IAM: 'iam',
  KMS: 'kms',
  Lambda: 'lambda',
  Logs: 'logs',
  RDS: 'rds',
  Route53: 'route53',
  S3: 's3',
  SES: 'ses',
  SQS: 'sqs',
  Scheduler: 'scheduler',
  SecretsManager: 'secretsmanager',
  WAFv2: 'wafv2',
};

/**
 * Every IAM action the policy may grant that is not a read (Get*, List*).
 * Growing this list is a security decision: it is meant to show up in review
 * as a diff to this file, not slip in through the JSON alone.
 */
const IAM_WRITES_ALLOWED = new Set([
  'iam:CreateRole',
  'iam:DeleteRole',
  'iam:UpdateRole',
  'iam:UpdateRoleDescription',
  'iam:UpdateAssumeRolePolicy',
  'iam:PutRolePolicy',
  'iam:DeleteRolePolicy',
  'iam:AttachRolePolicy',
  'iam:DetachRolePolicy',
  'iam:TagRole',
  'iam:UntagRole',
  'iam:PassRole',
  'iam:CreateInstanceProfile',
  'iam:DeleteInstanceProfile',
  'iam:AddRoleToInstanceProfile',
  'iam:RemoveRoleFromInstanceProfile',
  'iam:TagInstanceProfile',
  'iam:UntagInstanceProfile',
  'iam:CreateServiceLinkedRole',
]);

interface Statement {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function loadPolicy(): { Version: string; Statement: Statement[] } {
  return JSON.parse(fs.readFileSync(POLICY_PATH, 'utf-8'));
}

const allows = (): Statement[] => loadPolicy().Statement.filter((s) => s.Effect === 'Allow');

/** True if some Allow statement grants `action`, either exactly or via `<prefix>:*`. */
function grants(action: string): boolean {
  const [svc] = action.split(':');
  return allows().some((s) => asList(s.Action).some((a) => a === action || a === `${svc}:*`));
}

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

function everyResource(): Array<{ stack: string; id: string; res: CfnResource }> {
  const out: Array<{ stack: string; id: string; res: CfnResource }> = [];
  for (const overrides of Object.values(SYNTH_MODES)) {
    const synth = synthFanwire(overrides);
    for (const stack of synth.stackNames()) {
      const resources = (synth.json(stack).Resources ?? {}) as Record<string, CfnResource>;
      for (const [id, res] of Object.entries(resources)) out.push({ stack, id, res });
    }
  }
  return out;
}

describe('cfn-exec-role policy: shape', () => {
  test('is a valid policy document with only Allow statements', () => {
    const policy = loadPolicy();
    expect(policy.Version).toBe('2012-10-17');
    expect(policy.Statement.length).toBeGreaterThan(0);
    for (const s of policy.Statement) expect(s.Effect).toBe('Allow');
  });

  test('never grants a bare `*` action or `iam:*`', () => {
    const actions = allows().flatMap((s) => asList(s.Action));
    expect(actions).not.toContain('*');
    expect(actions).not.toContain('iam:*');
  });

  test('fits the managed-policy size limit (6,144 non-whitespace characters)', () => {
    const compact = fs.readFileSync(POLICY_PATH, 'utf-8').replace(/\s/g, '');
    expect(compact.length).toBeLessThanOrEqual(6144);
  });
});

describe('cfn-exec-role policy: coverage of what the stacks create', () => {
  test('every resource type maps to a known IAM service (extend TYPE_TO_IAM and the policy together)', () => {
    const unknown = new Set<string>();
    for (const { res } of everyResource()) {
      const [vendor, ns] = res.Type.split('::');
      if (vendor !== 'AWS' || ns === 'CDK') continue;
      if (!(ns in TYPE_TO_IAM)) unknown.add(res.Type);
    }
    expect([...unknown].sort()).toEqual([]);
  });

  test('every service the templates create resources in is granted', () => {
    const missing = new Set<string>();
    for (const { res } of everyResource()) {
      const [vendor, ns] = res.Type.split('::');
      if (vendor !== 'AWS' || !(ns in TYPE_TO_IAM)) continue;
      const svc = TYPE_TO_IAM[ns];
      // IAM is fenced by explicit actions below, not a service wildcard.
      if (svc === 'iam') continue;
      if (!grants(`${svc}:*`)) missing.add(`${svc} (for ${res.Type})`);
    }
    expect([...missing].sort()).toEqual([]);
  });

  test('custom resources can be invoked (they are Lambda-backed)', () => {
    const custom = everyResource().filter(({ res }) => res.Type.startsWith('Custom::'));
    expect(custom.length).toBeGreaterThan(0);
    expect(grants('lambda:InvokeFunction')).toBe(true);
  });
});

describe('cfn-exec-role policy: the IAM fence', () => {
  const iamStatements = (): Statement[] =>
    allows().filter((s) => asList(s.Action).some((a) => a.startsWith('iam:')));
  const isRead = (a: string): boolean => /^iam:(Get|List)/.test(a);

  test('IAM write actions are exactly the reviewed allow-list', () => {
    const writes = iamStatements()
      .flatMap((s) => asList(s.Action))
      .filter((a) => a.startsWith('iam:') && !isRead(a));
    for (const a of writes) expect(a).not.toMatch(/\*/);
    expect(new Set(writes)).toEqual(IAM_WRITES_ALLOWED);
  });

  test('IAM writes never mix with non-IAM actions in one statement', () => {
    for (const s of iamStatements()) {
      const actions = asList(s.Action);
      if (actions.some((a) => !isRead(a))) {
        expect(actions.filter((a) => !a.startsWith('iam:'))).toEqual([]);
      }
    }
  });

  test('IAM writes reach only Fanwire-* roles/instance profiles, or service-linked roles', () => {
    const fanwire = new RegExp(`^arn:aws:iam::${ACCOUNT}:(role|instance-profile)/Fanwire-\\*?$`);
    const slr = new RegExp(`^arn:aws:iam::${ACCOUNT}:role/aws-service-role/\\*$`);
    for (const s of iamStatements()) {
      const actions = asList(s.Action);
      if (!actions.some((a) => !isRead(a))) continue;
      const allowed = actions.every((a) => a === 'iam:CreateServiceLinkedRole') ? slr : fanwire;
      for (const r of asList(s.Resource)) expect(r).toMatch(allowed);
    }
  });

  test('managed-policy attachment is pinned to AWSLambdaBasicExecutionRole', () => {
    const attach = iamStatements().filter((s) => asList(s.Action).includes('iam:AttachRolePolicy'));
    expect(attach.length).toBeGreaterThan(0);
    for (const s of attach) {
      expect(asList(s.Action)).toEqual(['iam:AttachRolePolicy']);
      expect(asList(s.Condition?.ArnEquals?.['iam:PolicyARN'])).toEqual([LAMBDA_BASIC]);
    }
  });

  test('every managed policy the templates attach is the pinned one', () => {
    const attached = new Set<string>();
    for (const { res } of everyResource()) {
      if (res.Type !== 'AWS::IAM::Role') continue;
      for (const arn of (res.Properties?.ManagedPolicyArns as unknown[]) ?? []) {
        attached.add(JSON.stringify(arn).includes('AWSLambdaBasicExecutionRole') ? LAMBDA_BASIC : JSON.stringify(arn));
      }
    }
    expect([...attached]).toEqual([LAMBDA_BASIC]);
  });

  test('PassRole is conditioned on iam:PassedToService, covering every principal a template role trusts', () => {
    const pass = iamStatements().filter((s) => asList(s.Action).includes('iam:PassRole'));
    expect(pass.length).toBeGreaterThan(0);
    const passable = new Set<string>();
    for (const s of pass) {
      expect(asList(s.Action)).toEqual(['iam:PassRole']);
      const services = asList(s.Condition?.StringEquals?.['iam:PassedToService']);
      expect(services.length).toBeGreaterThan(0);
      services.forEach((x) => passable.add(x));
    }
    const trusted = new Set<string>();
    for (const { res } of everyResource()) {
      if (res.Type !== 'AWS::IAM::Role') continue;
      const doc = res.Properties?.AssumeRolePolicyDocument as { Statement: Array<{ Principal?: { Service?: string | string[] } }> };
      for (const st of doc.Statement) asList(st.Principal?.Service).forEach((x) => trusted.add(x));
    }
    expect([...trusted].filter((t) => !passable.has(t)).sort()).toEqual([]);
  });

  test('CreateServiceLinkedRole is conditioned on iam:AWSServiceName', () => {
    const slr = iamStatements().filter((s) => asList(s.Action).includes('iam:CreateServiceLinkedRole'));
    expect(slr.length).toBeGreaterThan(0);
    for (const s of slr) {
      expect(asList(s.Action)).toEqual(['iam:CreateServiceLinkedRole']);
      expect(asList(s.Condition?.StringEquals?.['iam:AWSServiceName']).length).toBeGreaterThan(0);
    }
  });

  test('the Fanwire-* scope holds: every stack is Fanwire-*, no role or profile sets a name or path', () => {
    for (const name of Object.values(STACK_NAMES)) expect(name).toMatch(/^Fanwire-/);
    const named: string[] = [];
    for (const { stack, id, res } of everyResource()) {
      if (res.Type !== 'AWS::IAM::Role' && res.Type !== 'AWS::IAM::InstanceProfile') continue;
      const p = res.Properties ?? {};
      if ('RoleName' in p || 'InstanceProfileName' in p || 'Path' in p) named.push(`${stack}/${id}`);
    }
    expect(named).toEqual([]);
  });
});
