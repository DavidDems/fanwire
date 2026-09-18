import * as fs from 'fs';
import * as path from 'path';
import { Match } from 'aws-cdk-lib/assertions';
import * as cxapi from 'aws-cdk-lib/cx-api';
import { DOMAIN_MODES, STACK_NAMES, resourcesOfType, synthFanwire, CfnResource } from './helpers';

const synth = () => synthFanwire();
const tpl = () => synth().template(STACK_NAMES.app);
const raw = () => synth().json(STACK_NAMES.app);
const functions = () => resourcesOfType(raw(), 'AWS::Lambda::Function');
const imageFunctions = () =>
  Object.entries(functions()).filter(([, f]) => f.Properties?.PackageType === 'Image');

const HANDLERS = {
  api: 'app.main.handler',
  ingestion: 'app.events.lambda_handler.handler',
  media: 'app.media.lambda_handler.handler',
  notifications: 'app.notifications.lambda_handler.handler',
} as const;

function fn(kind: keyof typeof HANDLERS): [string, CfnResource] {
  const hit = imageFunctions().find(([, f]) =>
    JSON.stringify((f.Properties?.ImageConfig as { Command?: string[] })?.Command) === JSON.stringify([HANDLERS[kind]]),
  );
  if (!hit) throw new Error(`no function for ${kind}`);
  return hit;
}

const roleOf = (f: CfnResource) => (f.Properties?.Role as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'][0];

/** Every AWS::IAM::Policy statement attached to a role, flattened. */
function statementsForRole(roleId: string): Record<string, unknown>[] {
  return Object.values(resourcesOfType(raw(), 'AWS::IAM::Policy'))
    .filter((p) => JSON.stringify(p.Properties?.Roles).includes(`"${roleId}"`))
    .flatMap((p) => (p.Properties?.PolicyDocument as { Statement: Record<string, unknown>[] }).Statement);
}
const actionsForRole = (roleId: string) =>
  statementsForRole(roleId).flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]) as string[]);
const envOf = (f: CfnResource) => (f.Properties?.Environment as { Variables: Record<string, unknown> }).Variables;

describe('App stack: one shared Lambda image', () => {
  test('exactly one Docker image asset in the whole app', () => {
    const images = synth()
      .assembly.artifacts.filter((a): a is cxapi.AssetManifestArtifact => a instanceof cxapi.AssetManifestArtifact)
      .flatMap((a) => Object.keys(a.contents.dockerImages ?? {}));
    expect(new Set(images).size).toBe(1);
  });

  test('built from the repo root with docker/backend.Dockerfile, target `lambda`', () => {
    const [manifest] = synth()
      .assembly.artifacts.filter((a): a is cxapi.AssetManifestArtifact => a instanceof cxapi.AssetManifestArtifact)
      .filter((a) => Object.keys(a.contents.dockerImages ?? {}).length > 0);
    const [image] = Object.values(manifest!.contents.dockerImages ?? {});
    expect(image?.source.dockerFile).toBe('docker/backend.Dockerfile');
    expect(image?.source.dockerBuildTarget).toBe('lambda');
    expect(image?.source.platform).toBe('linux/amd64');
  });

  test('staged build context is only what the Dockerfile needs (no node_modules, .git, frontend, infra)', () => {
    const [manifest] = synth()
      .assembly.artifacts.filter((a): a is cxapi.AssetManifestArtifact => a instanceof cxapi.AssetManifestArtifact)
      .filter((a) => Object.keys(a.contents.dockerImages ?? {}).length > 0);
    const [image] = Object.values(manifest!.contents.dockerImages ?? {});
    const dir = path.join(synth().assembly.directory, image!.source.directory!);
    // CDK always stages .dockerignore alongside the context (Docker reads it at build time)
    expect(fs.readdirSync(dir).sort()).toEqual(['.dockerignore', 'backend', 'docker']);
    expect(fs.readdirSync(path.join(dir, 'docker'))).toEqual(['backend.Dockerfile']);
    for (const entry of fs.readdirSync(path.join(dir, 'backend'))) {
      expect(['alembic', 'alembic.ini', 'app', 'pyproject.toml', 'tests']).toContain(entry);
    }
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? [e.name, ...walk(path.join(d, e.name))] : [e.name],
      );
    const names = walk(dir);
    for (const banned of ['node_modules', '.git', '__pycache__', '.venv', 'cdk.out']) expect(names).not.toContain(banned);
  });

  test('four image functions share one image URI; each overrides only its command', () => {
    expect(imageFunctions()).toHaveLength(4);
    const uris = new Set(imageFunctions().map(([, f]) => JSON.stringify((f.Properties?.Code as { ImageUri: unknown }).ImageUri)));
    expect(uris.size).toBe(1);
    for (const kind of Object.keys(HANDLERS) as (keyof typeof HANDLERS)[]) expect(fn(kind)).toBeDefined();
  });
});

describe('App stack: functions', () => {
  test('every function has its own role (security.md: no shared app role)', () => {
    const roles = Object.values(functions()).map(roleOf);
    expect(new Set(roles).size).toBe(roles.length);
  });

  test('every function logs to an explicit log group with finite retention (no logRetention custom resource)', () => {
    const groups = resourcesOfType(raw(), 'AWS::Logs::LogGroup');
    for (const f of Object.values(functions())) {
      const ref = JSON.stringify((f.Properties?.LoggingConfig as { LogGroup: unknown })?.LogGroup);
      const id = Object.keys(groups).find((g) => ref.includes(`"${g}"`));
      expect(id).toBeDefined();
      expect(groups[id!]?.Properties?.RetentionInDays).toEqual(expect.any(Number));
    }
    tpl().resourceCountIs('Custom::LogRetention', 0);
  });

  test('the four backend functions run in the app subnets with the Lambda SG; env encrypted with the CMK', () => {
    for (const [, f] of imageFunctions()) {
      const vpc = f.Properties?.VpcConfig as { SubnetIds: unknown[]; SecurityGroupIds: unknown[] };
      expect(vpc.SubnetIds).toHaveLength(2);
      expect(vpc.SecurityGroupIds).toHaveLength(1);
      expect(f.Properties?.KmsKeyArn).toBeDefined();
    }
  });

  test('DATABASE_URL is assembled from a Secrets Manager dynamic reference, never a literal password', () => {
    for (const [, f] of imageFunctions()) {
      const url = JSON.stringify(envOf(f).DATABASE_URL);
      expect(url).toContain('postgresql+psycopg://');
      expect(url).toContain('{{resolve:secretsmanager:');
    }
  });

  test('API function env lines up with app.settings.Settings and the Cognito verifier', () => {
    const env = envOf(fn('api')[1]);
    expect(env).toEqual(
      expect.objectContaining({
        COGNITO_REGION: 'ca-central-1',
        COGNITO_USER_POOL_ID: expect.anything(),
        COGNITO_APP_CLIENT_ID: expect.anything(),
        MEDIA_QUARANTINE_BUCKET: expect.anything(),
        MEDIA_PUBLIC_BUCKET: expect.anything(),
        POST_EVENT_BUS_NAME: expect.anything(),
      }),
    );
  });

  test('origin-verify authorizer: small zip function outside the VPC', () => {
    const others = Object.values(functions()).filter((f) => f.Properties?.PackageType !== 'Image');
    expect(others).toHaveLength(1);
    expect(others[0]?.Properties?.Runtime).toBe('python3.12');
    expect(others[0]?.Properties?.VpcConfig).toBeUndefined();
  });
});

describe('App stack: least privilege', () => {
  test('API-SPORTS secret is readable by the ingestion role only', () => {
    const readers = Object.values(resourcesOfType(raw(), 'AWS::IAM::Policy')).filter((p) =>
      JSON.stringify(p.Properties?.PolicyDocument).includes('ApiSportsKey'),
    );
    expect(readers).toHaveLength(1);
    expect(JSON.stringify(readers[0]?.Properties?.Roles)).toContain(roleOf(fn('ingestion')[1]));
  });

  test('API role: presign quarantine uploads, cache table, PutEvents; nothing from the media pipeline', () => {
    const actions = actionsForRole(roleOf(fn('api')[1]));
    expect(actions).toEqual(expect.arrayContaining(['s3:PutObject', 'events:PutEvents', 'dynamodb:GetItem']));
    expect(actions).not.toContain('s3:DeleteObject');
    expect(actions).not.toContain('secretsmanager:GetSecretValue');
  });

  test('media role: read/delete quarantine, write public media, consume the scan-result queue', () => {
    const actions = actionsForRole(roleOf(fn('media')[1]));
    expect(actions).toEqual(
      expect.arrayContaining(['s3:GetObject', 's3:DeleteObject', 's3:PutObject', 'sqs:ReceiveMessage', 'sqs:DeleteMessage']),
    );
    expect(actions).not.toContain('secretsmanager:GetSecretValue');
  });

  test('notifications role: consume its queue and look up the recipient in Cognito', () => {
    const actions = actionsForRole(roleOf(fn('notifications')[1]));
    expect(actions).toEqual(expect.arrayContaining(['sqs:ReceiveMessage', 'cognito-idp:AdminGetUser']));
    expect(actions).not.toContain('s3:PutObject');
  });

  test('no role in this stack has a managed policy', () => {
    for (const r of Object.values(resourcesOfType(raw(), 'AWS::IAM::Role'))) {
      expect(r.Properties?.ManagedPolicyArns).toBeUndefined();
    }
  });
});

describe('App stack: triggers', () => {
  test('HTTP API with a throttled $default stage', () => {
    tpl().hasResourceProperties('AWS::ApiGatewayV2::Api', { ProtocolType: 'HTTP' });
    tpl().hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AutoDeploy: true,
      DefaultRouteSettings: Match.objectLike({ ThrottlingBurstLimit: Match.anyValue(), ThrottlingRateLimit: Match.anyValue() }),
      AccessLogSettings: Match.objectLike({ DestinationArn: Match.anyValue() }),
    });
  });

  test('every route requires the origin-verify Lambda authorizer (header identity source, cached)', () => {
    tpl().hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'REQUEST',
      IdentitySource: ['$request.header.x-origin-verify'],
      EnableSimpleResponses: true,
      AuthorizerPayloadFormatVersion: '2.0',
      AuthorizerResultTtlInSeconds: 300,
    });
    const routes = Object.values(resourcesOfType(raw(), 'AWS::ApiGatewayV2::Route'));
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) expect(r.Properties?.AuthorizationType).toBe('CUSTOM');
  });

  test('EventBridge Scheduler runs ingestion hourly with retries, a DLQ, and its own scoped role', () => {
    tpl().hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'rate(1 hour)',
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: Match.objectLike({
        Arn: { 'Fn::GetAtt': [fn('ingestion')[0], 'Arn'] },
        RoleArn: Match.anyValue(),
        DeadLetterConfig: { Arn: Match.anyValue() },
        RetryPolicy: Match.objectLike({ MaximumRetryAttempts: Match.anyValue() }),
      }),
    });
    tpl().hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: 'scheduler.amazonaws.com' },
            Condition: { StringEquals: { 'aws:SourceAccount': '294321867941' } },
          }),
        ],
      },
    });
  });

  test('failed async ingestion runs go to the ingestion retry queue', () => {
    tpl().hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
      FunctionName: { Ref: fn('ingestion')[0] },
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
    });
  });

  test('SQS event source mappings: notifications, ingestion retries, media scan results', () => {
    const esms = Object.values(resourcesOfType(raw(), 'AWS::Lambda::EventSourceMapping'));
    expect(esms).toHaveLength(3);
    const targets = esms.map((e) => (e.Properties?.FunctionName as { Ref: string }).Ref).sort();
    expect(targets).toEqual([fn('ingestion')[0], fn('media')[0], fn('notifications')[0]].sort());
    for (const e of esms) expect(e.Properties?.FunctionResponseTypes).toEqual(['ReportBatchItemFailures']);
  });
});

describe.each(Object.entries(DOMAIN_MODES))('App stack SES permission (%s)', (mode, overrides) => {
  test('notifications may send email only from the site domain identity, and only once a domain exists', () => {
    const t = synthFanwire(overrides).json(STACK_NAMES.app);
    const policies = JSON.stringify(resourcesOfType(t, 'AWS::IAM::Policy'));
    if (mode === 'no domain') {
      expect(policies).not.toContain('ses:SendEmail');
    } else {
      expect(policies).toContain('ses:SendEmail');
      expect(policies).toContain(':identity/fanwire.daviddems.ca');
    }
  });
});
