/**
 * The IAM merge gate. Synthesizes EVERY stack (in every domain mode) and
 * walks every policy document in every template -- identity policies
 * (AWS::IAM::Policy, AWS::IAM::ManagedPolicy, inline Role policies, trust
 * policies) and resource policies (S3 bucket policies, SQS queue policies,
 * KMS key policies, and anything else carrying a `Statement` array) plus
 * AWS::Lambda::Permission -- including everything CDK generated rather than
 * us writing it by hand.
 *
 * Fails on (wiki/CodeContext/Standards/security.md "Identity & access":
 * "No `*` in an Action or Resource field in production IAM policy, ever"):
 *   - any Action containing `*`, and any NotAction at all;
 *   - any Resource containing `*` (not just equal to it: `bucket/*` or
 *     `rule/Prefix*` are wildcards too and must be justified), and any
 *     NotResource at all;
 *   - any Allow statement whose Principal is `*`;
 *   - any AWS managed policy attached to a role, except
 *     AWSLambdaBasicExecutionRole (only CDK's own cross-region-reference
 *     custom resource provider uses it; our Lambdas get explicit statements);
 *   - any IAM user or group.
 *
 * Exceptions live in ALLOW_LIST below, each with the reason AWS requires
 * it. Every entry must still match something (see the last test), so the
 * list can't silently rot into a blanket pass.
 */
import { DOMAIN_MODES, STACK_NAMES, synthFanwire, CfnResource } from './helpers';

interface Finding {
  readonly stack: string;
  readonly logicalId: string;
  readonly resourceType: string;
  /** What was wrong: which field of which statement. */
  readonly kind: 'action' | 'notAction' | 'resource' | 'notResource' | 'publicPrincipal' | 'managedPolicy' | 'iamUserOrGroup';
  /** JSON of the offending value. */
  readonly value: string;
  readonly statement?: Record<string, unknown>;
}

interface AllowListEntry {
  readonly id: string;
  readonly reason: string;
  readonly matches: (f: Finding) => boolean;
}

const json = (v: unknown) => JSON.stringify(v);
const actionsOf = (s: Record<string, unknown>): string[] => {
  const a = s.Action;
  return (Array.isArray(a) ? a : a === undefined ? [] : [a]).map((x) => (typeof x === 'string' ? x : json(x)));
};
const onlyActions = (s: Record<string, unknown> | undefined, allowed: string[]) =>
  !!s && actionsOf(s).length > 0 && actionsOf(s).every((a) => allowed.includes(a));
const hasCondition = (s: Record<string, unknown> | undefined, needle: string) =>
  !!s && json(s.Condition ?? {}).includes(needle);

/**
 * Keep this list as short as possible. Each entry names the one narrow
 * shape it permits; anything else with a wildcard fails the build.
 */
const ALLOW_LIST: AllowListEntry[] = [
  {
    id: 'kms-key-policy-self',
    reason:
      'In a KMS key policy, Resource "*" means "this key" -- a key policy can only ever grant on the key it is ' +
      'attached to. AWS requires this form (https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-overview.html).',
    matches: (f) => f.resourceType === 'AWS::KMS::Key' && f.kind === 'resource' && f.value === '"*"',
  },
  {
    id: 's3-object-arns',
    reason:
      'S3 object-level actions (GetObject/PutObject/DeleteObject/...Tagging) are authorized against object ARNs; ' +
      '`<one specific bucket ARN>/*` (or `/<prefix>/*`) is how AWS scopes them to a single bucket. The bucket part must be a ' +
      'concrete reference, never a wildcard.',
    matches: (f) =>
      f.kind === 'resource' &&
      // exactly one `*`, as the final path segment, after a concrete bucket reference
      (f.value.match(/\*/g) ?? []).length === 1 &&
      /\/\*"\]\]\}$|\/\*"$/.test(f.value) &&
      (/"Fn::GetAtt":\["[A-Za-z0-9]*Bucket[A-Za-z0-9]*","Arn"\]/.test(f.value) ||
        /arn:[^"]*:s3:::/.test(f.value) ||
        /"Fn::ImportValue":"[^"]*Bucket[^"]*"/.test(f.value)),
  },
  {
    id: 'tls-only-deny',
    reason:
      'The "deny any request not over TLS" guard (aws:SecureTransport=false) must cover every action on the bucket/queue, ' +
      'so it is written as `s3:*` / `sqs:*`. It is a Deny, so the wildcard can only ever remove access, never grant it.',
    matches: (f) =>
      f.kind === 'action' &&
      (f.value === 's3:*' || f.value === 'sqs:*') &&
      f.statement?.Effect === 'Deny' &&
      hasCondition(f.statement, 'aws:SecureTransport'),
  },
  {
    id: 'lambda-vpc-eni',
    reason:
      'A VPC-attached Lambda\'s execution role must hold the ENI actions AWS lists for AWSLambdaVPCAccessExecutionRole ' +
      '(https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html#configuration-vpc-permissions). ' +
      'ec2:Describe* has no resource-level permissions at all, and Lambda validates the role against the rest with ' +
      'Resource "*" at CreateFunction time, so they are written exactly as AWS\'s own managed policy writes them -- ' +
      'inline, so no managed policy is attached.',
    matches: (f) =>
      f.kind === 'resource' &&
      f.value === '"*"' &&
      onlyActions(f.statement, [
        'ec2:CreateNetworkInterface',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DescribeSubnets',
        'ec2:DeleteNetworkInterface',
        'ec2:AssignPrivateIpAddresses',
        'ec2:UnassignPrivateIpAddresses',
      ]),
  },
  {
    id: 'nat-instance-session-manager',
    reason:
      'The NAT instance (human decision 2026-09-18) is administered via SSM Session Manager only (no SSH). ' +
      "Its role holds exactly AWS's documented minimum for the Session Manager agent " +
      '(https://docs.aws.amazon.com/systems-manager/latest/userguide/getting-started-create-iam-instance-profile.html): ' +
      'ssmmessages:* channel actions have no resource-level permissions, and ssm:UpdateInstanceInformation is called ' +
      'before the agent knows its managed-instance ARN. Replaces the AmazonSSMManagedInstanceCore managed policy.',
    matches: (f) =>
      f.kind === 'resource' &&
      f.value === '"*"' &&
      onlyActions(f.statement, [
        'ssm:UpdateInstanceInformation',
        'ssmmessages:CreateControlChannel',
        'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel',
        'ssmmessages:OpenDataChannel',
      ]),
  },
  {
    id: 'guardduty-managed-eventbridge-rule',
    reason:
      'GuardDuty Malware Protection for S3 creates its own EventBridge managed rule named ' +
      '`DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*` (suffix chosen by GuardDuty) and AWS\'s documented role policy ' +
      'scopes to that prefix (https://docs.aws.amazon.com/guardduty/latest/ug/malware-protection-s3-iam-policy-prerequisite.html). ' +
      'The statement is additionally conditioned on events:ManagedBy = the GuardDuty service.',
    matches: (f) =>
      f.kind === 'resource' &&
      (f.value.match(/\*/g) ?? []).length === 1 &&
      f.value.includes(':rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*'),
  },
  {
    id: 'cdk-cross-region-export-parameters',
    reason:
      'crossRegionReferences (the settled way to pass the us-east-1 ACM cert / WAF ARNs to the CloudFront stack) is ' +
      'implemented by CDK as SSM parameters under `/cdk/exports/<consumer stack>/...`, whose names CDK derives at deploy ' +
      'time. Its writer/reader roles scope to that path prefix; there is no native-CFN equivalent for cross-region refs.',
    matches: (f) =>
      f.kind === 'resource' &&
      (f.value.match(/\*/g) ?? []).length === 1 &&
      // writer: `/cdk/exports/*` in the consumer region; reader: `/cdk/exports/<consumer stack>/*`
      /:parameter\/cdk\/exports\/([A-Za-z0-9-]+\/)?\*"/.test(f.value.replace(/"\]\]\}$/, '"')),
  },
  {
    id: 'cdk-custom-resource-basic-execution',
    reason:
      'CDK\'s cross-region-reference custom resource provider (Custom::CrossRegionExportWriter/Reader) attaches ' +
      'AWSLambdaBasicExecutionRole for its own logging and exposes no way to replace it. It only grants ' +
      'logs:CreateLogGroup/CreateLogStream/PutLogEvents.',
    matches: (f) => f.kind === 'managedPolicy' && f.value.includes('policy/service-role/AWSLambdaBasicExecutionRole'),
  },
];

/** Recursively yields every policy-document-shaped object (anything with a Statement array). */
function* policyDocuments(value: unknown, path: string): Generator<{ path: string; doc: Record<string, unknown> }> {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* policyDocuments(value[i], `${path}[${i}]`);
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.Statement)) {
      yield { path, doc: obj };
      return;
    }
    for (const [k, v] of Object.entries(obj)) yield* policyDocuments(v, `${path}.${k}`);
  }
}

function asList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined ? [] : [v];
}

function findingsFor(stack: string, logicalId: string, resource: CfnResource): Finding[] {
  const out: Finding[] = [];
  const base = { stack, logicalId, resourceType: resource.Type };

  if (resource.Type === 'AWS::IAM::User' || resource.Type === 'AWS::IAM::Group') {
    out.push({ ...base, kind: 'iamUserOrGroup', value: resource.Type });
  }

  for (const { doc } of policyDocuments(resource.Properties ?? {}, 'Properties')) {
    for (const raw of asList(doc.Statement)) {
      const statement = raw as Record<string, unknown>;
      for (const a of asList(statement.Action)) {
        const value = typeof a === 'string' ? a : json(a);
        if (value.includes('*')) out.push({ ...base, kind: 'action', value, statement });
      }
      if (statement.NotAction !== undefined) {
        out.push({ ...base, kind: 'notAction', value: json(statement.NotAction), statement });
      }
      for (const r of asList(statement.Resource)) {
        const value = json(r);
        if (value.includes('*')) out.push({ ...base, kind: 'resource', value, statement });
      }
      if (statement.NotResource !== undefined) {
        out.push({ ...base, kind: 'notResource', value: json(statement.NotResource), statement });
      }
      const principal = json(statement.Principal ?? null);
      if (statement.Effect === 'Allow' && (principal === '"*"' || principal === '{"AWS":"*"}')) {
        out.push({ ...base, kind: 'publicPrincipal', value: principal, statement });
      }
    }
  }

  if (resource.Type === 'AWS::IAM::Role') {
    for (const arn of asList(resource.Properties?.ManagedPolicyArns)) {
      out.push({ ...base, kind: 'managedPolicy', value: json(arn) });
    }
  }

  if (resource.Type === 'AWS::Lambda::Permission') {
    const p = resource.Properties ?? {};
    const action = json(p.Action);
    if (action.includes('*')) out.push({ ...base, kind: 'action', value: action });
    if (json(p.FunctionName) === '"*"') out.push({ ...base, kind: 'resource', value: '"*"' });
    if (json(p.Principal) === '"*"') out.push({ ...base, kind: 'publicPrincipal', value: '"*"' });
  }

  return out;
}

function allFindings(overrides: Record<string, unknown>): Finding[] {
  const synth = synthFanwire(overrides);
  const findings: Finding[] = [];
  for (const stack of synth.stackNames()) {
    for (const [logicalId, resource] of Object.entries(synth.json(stack).Resources ?? {})) {
      findings.push(...findingsFor(stack, logicalId, resource));
    }
  }
  return findings;
}

const usedAllowListEntries = new Set<string>();

describe.each(Object.entries(DOMAIN_MODES))('IAM wildcard gate (%s)', (_mode, overrides) => {
  test('synthesizes every expected stack', () => {
    expect(synthFanwire(overrides).stackNames().sort()).toEqual(Object.values(STACK_NAMES).sort());
  });

  test('no wildcard action/resource, public principal, or managed policy outside the allow-list', () => {
    const violations: string[] = [];
    for (const f of allFindings(overrides)) {
      const entry = ALLOW_LIST.find((e) => e.matches(f));
      if (entry) {
        usedAllowListEntries.add(entry.id);
        // `IAM_GATE_REPORT=1 npx jest test/iam-policy.test.ts` lists every excepted finding for review.
        if (process.env.IAM_GATE_REPORT) console.log(`[${_mode}] ${entry.id}: ${f.stack}/${f.logicalId} ${f.kind} ${f.value}`);
      } else {
        violations.push(`${f.stack}/${f.logicalId} (${f.resourceType}) ${f.kind}: ${f.value}` +
          (f.statement ? `\n    statement: ${json(f.statement)}` : ''));
      }
    }
    expect(violations).toEqual([]);
  });

  test('the walker actually sees policies (guards against a walker that silently finds nothing)', () => {
    const synth = synthFanwire(overrides);
    let documents = 0;
    for (const stack of synth.stackNames()) {
      for (const r of Object.values(synth.json(stack).Resources ?? {})) {
        documents += [...policyDocuments(r.Properties ?? {}, 'Properties')].length;
      }
    }
    expect(documents).toBeGreaterThan(20);
  });
});

describe('allow-list hygiene', () => {
  test('every allow-list entry has a reason', () => {
    for (const e of ALLOW_LIST) expect(e.reason.length).toBeGreaterThan(40);
  });

  test('every allow-list entry is still needed by at least one synthesized mode', () => {
    // Runs after the describe.each blocks above (jest runs tests in file order).
    expect(ALLOW_LIST.map((e) => e.id).filter((id) => !usedAllowListEntries.has(id))).toEqual([]);
  });

  test('the walker flags a wildcard it has not been told about', () => {
    const fake: CfnResource = {
      Type: 'AWS::IAM::Policy',
      Properties: {
        PolicyDocument: {
          Statement: [{ Effect: 'Allow', Action: 's3:GetObject*', Resource: '*' }],
        },
      },
    };
    const findings = findingsFor('Fake', 'P', fake);
    expect(findings.map((f) => f.kind).sort()).toEqual(['action', 'resource']);
    expect(findings.filter((f) => ALLOW_LIST.some((e) => e.matches(f)))).toEqual([]);
  });
});
