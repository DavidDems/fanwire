import { Match } from 'aws-cdk-lib/assertions';
import { STACK_NAMES, resourcesOfType, synthFanwire } from './helpers';

const tpl = () => synthFanwire().template(STACK_NAMES.data);
const raw = () => synthFanwire().json(STACK_NAMES.data);

describe('Data stack', () => {
  describe('customer-managed KMS key', () => {
    test('exactly one CMK, rotation on, retained on stack deletion', () => {
      tpl().resourceCountIs('AWS::KMS::Key', 1);
      tpl().hasResource('AWS::KMS::Key', {
        Properties: Match.objectLike({ EnableKeyRotation: true }),
        DeletionPolicy: 'Retain',
      });
      tpl().hasResourceProperties('AWS::KMS::Alias', { AliasName: 'alias/fanwire' });
    });

    test('key policy: account root delegation with enumerated actions (no kms:*)', () => {
      const key = Object.values(resourcesOfType(raw(), 'AWS::KMS::Key'))[0];
      const statements = (key?.Properties?.KeyPolicy as { Statement: Record<string, unknown>[] }).Statement;
      const root = statements.find((s) => JSON.stringify(s.Principal).includes(':root'));
      expect(root).toBeDefined();
      const actions = root?.Action as string[];
      expect(actions).toEqual(expect.arrayContaining(['kms:PutKeyPolicy', 'kms:Decrypt', 'kms:GenerateDataKey', 'kms:CreateGrant']));
      for (const a of actions) expect(a).not.toContain('*');
    });

    test('CloudFront may decrypt (public-media via OAC) only for distributions in this account', () => {
      tpl().hasResourceProperties('AWS::KMS::Key', {
        KeyPolicy: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Principal: { Service: 'cloudfront.amazonaws.com' },
              Action: 'kms:Decrypt',
              Condition: Match.objectLike({
                StringEquals: { 'aws:SourceAccount': '294321867941' },
                ArnLike: { 'aws:SourceArn': 'arn:aws:cloudfront::294321867941:distribution/*' },
              }),
            }),
          ]),
        },
      });
    });

    test('EventBridge may encrypt into CMK-encrypted SQS only for rules in this account/region', () => {
      tpl().hasResourceProperties('AWS::KMS::Key', {
        KeyPolicy: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: 'events.amazonaws.com' },
              Action: ['kms:Decrypt', 'kms:GenerateDataKey'],
              Condition: Match.objectLike({
                StringEquals: { 'aws:SourceAccount': '294321867941' },
                ArnLike: { 'aws:SourceArn': 'arn:aws:events:ca-central-1:294321867941:rule/*' },
              }),
            }),
          ]),
        },
      });
    });
  });

  describe('RDS Postgres', () => {
    test('db.t4g.micro Postgres, single-AZ, private, encrypted with the CMK', () => {
      tpl().resourceCountIs('AWS::RDS::DBInstance', 1);
      tpl().hasResourceProperties('AWS::RDS::DBInstance', {
        Engine: 'postgres',
        DBInstanceClass: 'db.t4g.micro',
        MultiAZ: false,
        PubliclyAccessible: false,
        StorageEncrypted: true,
        KmsKeyId: Match.anyValue(),
        DeletionProtection: true,
        VPCSecurityGroups: Match.anyValue(),
        DBName: 'fanwire',
      });
    });

    test('Postgres 18, upgraded in place: same logical id, major upgrade allowed, snapshot on delete (INFRA-007)', () => {
      // aws-cdk-lib 2.277 has no PostgresEngineVersion.VER_19, so 18. A moved
      // logical id would make CloudFormation create a second, empty instance
      // instead of upgrading the live one.
      const instances = resourcesOfType(raw(), 'AWS::RDS::DBInstance');
      expect(Object.keys(instances)).toEqual(['Postgres9DC8BB04']);
      const db = instances.Postgres9DC8BB04;
      expect(db?.Properties?.Engine).toBe('postgres');
      expect(db?.Properties?.EngineVersion).toBe('18');
      expect(db?.Properties?.AllowMajorVersionUpgrade).toBe(true);
      expect(db?.Properties?.AutoMinorVersionUpgrade).toBe(true);
      expect(db?.Properties?.DBParameterGroupName).toBeUndefined();
      expect(db?.DeletionPolicy).toBe('Snapshot');
      expect(db?.UpdateReplacePolicy).toBe('Snapshot');
    });

    test('credentials are generated into Secrets Manager (CMK-encrypted), never a literal password', () => {
      const db = Object.values(resourcesOfType(raw(), 'AWS::RDS::DBInstance'))[0];
      expect(JSON.stringify(db?.Properties?.MasterUserPassword)).toContain('{{resolve:secretsmanager:');
      tpl().hasResourceProperties('AWS::SecretsManager::Secret', {
        GenerateSecretString: Match.objectLike({ GenerateStringKey: 'password' }),
        KmsKeyId: Match.anyValue(),
      });
    });

    test('subnet group uses the isolated data subnets', () => {
      tpl().resourceCountIs('AWS::RDS::DBSubnetGroup', 1);
    });
  });

  test('no DynamoDB table: the idempotency and live-score cache tables went with API-SPORTS (INFRA-005)', () => {
    tpl().resourceCountIs('AWS::DynamoDB::Table', 0);
  });

  describe('secrets', () => {
    test('three CMK-encrypted secrets: DB credentials, CloudFront origin-verify value, Kaggle API token placeholder', () => {
      tpl().resourceCountIs('AWS::SecretsManager::Secret', 3);
      for (const s of Object.values(resourcesOfType(raw(), 'AWS::SecretsManager::Secret'))) {
        expect(s.Properties?.KmsKeyId).toBeDefined();
        // never a literal value committed in code/template
        expect(s.Properties?.SecretString).toBeUndefined();
        expect(String(s.Properties?.Description ?? '')).not.toMatch(/API-SPORTS/);
      }
      tpl().hasResourceProperties('AWS::SecretsManager::Secret', {
        Description: Match.stringLikeRegexp('origin-verify'),
      });
    });
  });

  // EVENTS-008: the Kaggle token is put there by hand; the placeholder makes a
  // first run before that fail loud. Retained so a stack delete never loses it.
  test('Kaggle API token secret: fanwire/kaggle-api-token, CMK, Retain, generated placeholder, described', () => {
    const hits = Object.values(resourcesOfType(raw(), 'AWS::SecretsManager::Secret')).filter(
      (r) => r.Properties?.Name === 'fanwire/kaggle-api-token',
    );
    expect(hits).toHaveLength(1);
    const secret = hits[0]!;
    expect(secret.Properties?.KmsKeyId).toBeDefined();
    expect(secret['DeletionPolicy']).toBe('Retain');
    expect(secret.Properties?.GenerateSecretString).toBeDefined();
    expect(secret.Properties?.SecretString).toBeUndefined();
    expect(secret.Properties?.Description).toMatch(/Kaggle API token/);
  });

  test('Kaggle API token secret ARN is exported for Fanwire-App', () => {
    const ids = Object.entries(resourcesOfType(raw(), 'AWS::SecretsManager::Secret'))
      .filter(([, r]) => r.Properties?.Name === 'fanwire/kaggle-api-token')
      .map(([id]) => id);
    expect(ids).toHaveLength(1);
    const outputs = Object.values((raw().Outputs ?? {}) as Record<string, { Value?: unknown; Export?: { Name?: unknown } }>);
    expect(outputs.some((o) => JSON.stringify(o.Value) === JSON.stringify({ Ref: ids[0] }) && o.Export?.Name !== undefined)).toBe(true);
  });

  test('no custom-resource Lambdas', () => {
    tpl().resourceCountIs('AWS::Lambda::Function', 0);
  });
});

/**
 * INFRA-005: EVENTS-003 removed every consumer of the API-SPORTS resources and
 * its deploy stopped Fanwire-App importing their exports, so the resources and
 * the five exports go together. The two RETAIN ones (the idempotency table and
 * the API-SPORTS secret) are orphaned by the deploy and deleted by hand.
 */
describe('Data stack: API-SPORTS resources and their exports are gone (INFRA-005)', () => {
  const outputs = () => (raw().Outputs ?? {}) as Record<string, { Value?: unknown; Export?: { Name?: unknown } }>;

  test.each(['IdempotencyTable22A5A209', 'LiveScoreCacheTable277AE7C2', 'ApiSportsKey4432EB4A'])(
    '%s no longer synthesizes',
    (logicalId) => {
      expect(Object.keys(raw().Resources ?? {})).not.toContain(logicalId);
    },
  );

  test.each([
    'ExportsOutputFnGetAttIdempotencyTable22A5A209Arn796E3A97',
    'ExportsOutputFnGetAttLiveScoreCacheTable277AE7C2Arn3F1E2DD3',
    'ExportsOutputRefApiSportsKey4432EB4A2C8D0DDC',
    'ExportsOutputRefIdempotencyTable22A5A209F6C0179A',
    'ExportsOutputRefLiveScoreCacheTable277AE7C28479FE72',
  ])('output %s is gone', (outputId) => {
    expect(Object.keys(outputs())).not.toContain(outputId);
  });

  test('what stays: the CMK, RDS, the origin-verify and Kaggle secrets, and the Kaggle and RDS exports', () => {
    const resources = raw().Resources ?? {};
    expect(resources.Key961B73FD?.Type).toBe('AWS::KMS::Key');
    expect(resources.Postgres9DC8BB04?.Type).toBe('AWS::RDS::DBInstance');
    expect(resources.OriginVerifyED6A82E8?.Type).toBe('AWS::SecretsManager::Secret');
    expect(resources.KaggleApiToken964B5948?.Type).toBe('AWS::SecretsManager::Secret');
    expect(outputs().ExportsOutputRefKaggleApiToken964B59487D5E2AC7?.Value).toEqual({ Ref: 'KaggleApiToken964B5948' });
    expect(outputs().ExportsOutputRefPostgres9DC8BB0479C34812?.Value).toEqual({ Ref: 'Postgres9DC8BB04' });
  });
});
