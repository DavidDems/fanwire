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

  describe('DynamoDB (on-demand, CMK)', () => {
    test('idempotency table is aws-lambda-powertools Idempotency compatible: pk `id`, TTL `expiration`', () => {
      tpl().hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        TimeToLiveSpecification: { AttributeName: 'expiration', Enabled: true },
        SSESpecification: Match.objectLike({ SSEEnabled: true, SSEType: 'KMS', KMSMasterKeyId: Match.anyValue() }),
      });
    });

    test('live-score cache table: TTL on, on-demand, CMK', () => {
      tpl().hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        TimeToLiveSpecification: { AttributeName: 'expires_at', Enabled: true },
        SSESpecification: Match.objectLike({ SSEEnabled: true, SSEType: 'KMS' }),
      });
      tpl().resourceCountIs('AWS::DynamoDB::Table', 2);
    });
  });

  describe('secrets', () => {
    test('three CMK-encrypted secrets: DB credentials, API-SPORTS key placeholder, CloudFront origin-verify value', () => {
      tpl().resourceCountIs('AWS::SecretsManager::Secret', 3);
      for (const s of Object.values(resourcesOfType(raw(), 'AWS::SecretsManager::Secret'))) {
        expect(s.Properties?.KmsKeyId).toBeDefined();
        // never a literal value committed in code/template
        expect(s.Properties?.SecretString).toBeUndefined();
      }
      tpl().hasResourceProperties('AWS::SecretsManager::Secret', {
        Description: Match.stringLikeRegexp('API-SPORTS'),
      });
      tpl().hasResourceProperties('AWS::SecretsManager::Secret', {
        Description: Match.stringLikeRegexp('origin-verify'),
      });
    });
  });

  test('no custom-resource Lambdas', () => {
    tpl().resourceCountIs('AWS::Lambda::Function', 0);
  });
});

/**
 * EVENTS-003 removed every consumer of the API-SPORTS resources from the App
 * stack, but the resources stay, and so do their exports: the deployed
 * Fanwire-App still imports them, and CloudFormation refuses to update
 * Fanwire-Data if an export in use disappears. Each export is pinned by the
 * exact name the deployed App stack imports, with the value it carried. A
 * later infra unit deletes the resources and these exports together.
 */
describe('Data stack: API-SPORTS resources stay, still exported (EVENTS-003)', () => {
  const outputs = () => (raw().Outputs ?? {}) as Record<string, { Value?: unknown; Export?: { Name?: unknown } }>;

  const EXPORTS = [
    ['ExportsOutputFnGetAttIdempotencyTable22A5A209Arn796E3A97', { 'Fn::GetAtt': ['IdempotencyTable22A5A209', 'Arn'] }],
    ['ExportsOutputFnGetAttLiveScoreCacheTable277AE7C2Arn3F1E2DD3', { 'Fn::GetAtt': ['LiveScoreCacheTable277AE7C2', 'Arn'] }],
    ['ExportsOutputRefApiSportsKey4432EB4A2C8D0DDC', { Ref: 'ApiSportsKey4432EB4A' }],
    ['ExportsOutputRefIdempotencyTable22A5A209F6C0179A', { Ref: 'IdempotencyTable22A5A209' }],
    ['ExportsOutputRefLiveScoreCacheTable277AE7C28479FE72', { Ref: 'LiveScoreCacheTable277AE7C2' }],
  ] as const;

  test.each(EXPORTS)('exports %s under the name the deployed App stack imports', (outputId, value) => {
    const output = outputs()[outputId];
    expect(Object.keys(outputs())).toContain(outputId);
    expect(output?.Export?.Name).toBe(`${STACK_NAMES.data}:${outputId}`);
    expect(output?.Value).toEqual(value);
  });

  test('the idempotency table, the live-score cache table and the API-SPORTS secret still synthesize', () => {
    const resources = raw().Resources ?? {};
    expect(resources.IdempotencyTable22A5A209?.Type).toBe('AWS::DynamoDB::Table');
    expect(resources.LiveScoreCacheTable277AE7C2?.Type).toBe('AWS::DynamoDB::Table');
    expect(resources.ApiSportsKey4432EB4A?.Type).toBe('AWS::SecretsManager::Secret');
  });
});
