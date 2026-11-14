import { Match } from 'aws-cdk-lib/assertions';
import { DOMAIN_MODES, STACK_NAMES, resourcesOfType, synthFanwire, CfnResource } from './helpers';

const tpl = () => synthFanwire().template(STACK_NAMES.storage);
const raw = () => synthFanwire().json(STACK_NAMES.storage);

function bucketByTag(purpose: string): [string, CfnResource] {
  const hit = Object.entries(resourcesOfType(raw(), 'AWS::S3::Bucket')).find(([, b]) =>
    JSON.stringify(b.Properties?.Tags ?? []).includes(`"Value":"${purpose}"`),
  );
  if (!hit) throw new Error(`no bucket tagged purpose=${purpose}`);
  return hit;
}

describe('Storage stack', () => {
  test('exactly four buckets, all fully public-access-blocked and owner-enforced', () => {
    tpl().resourceCountIs('AWS::S3::Bucket', 4);
    for (const b of Object.values(resourcesOfType(raw(), 'AWS::S3::Bucket'))) {
      expect(b.Properties?.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(JSON.stringify(b.Properties?.OwnershipControls)).toContain('BucketOwnerEnforced');
    }
  });

  describe('quarantine bucket', () => {
    test('SSE-KMS with the CMK + bucket key, no versioning, 1-day expiry', () => {
      const [, b] = bucketByTag('media-quarantine');
      expect(JSON.stringify(b.Properties?.BucketEncryption)).toContain('"SSEAlgorithm":"aws:kms"');
      expect(JSON.stringify(b.Properties?.BucketEncryption)).toContain('"BucketKeyEnabled":true');
      expect(b.Properties?.VersioningConfiguration).toBeUndefined();
      const rules = (b.Properties?.LifecycleConfiguration as { Rules: Record<string, unknown>[] }).Rules;
      expect(rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ExpirationInDays: 1, Status: 'Enabled' }),
          expect.objectContaining({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }),
        ]),
      );
    });

    test('presigned-POST CORS on the quarantine bucket only (not PUT -- a presigned PUT cannot cap object size)', () => {
      const [, q] = bucketByTag('media-quarantine');
      expect(q.Properties?.CorsConfiguration).toEqual({
        CorsRules: [
          expect.objectContaining({ AllowedMethods: ['POST'], AllowedHeaders: ['Content-Type'] }),
        ],
      });
      for (const purpose of ['media-public', 'frontend-static']) {
        expect(bucketByTag(purpose)[1].Properties?.CorsConfiguration).toBeUndefined();
      }
    });

    test('bucket policy: TLS only, and no GetObject on anything GuardDuty has not tagged NO_THREATS_FOUND', () => {
      const [qid] = bucketByTag('media-quarantine');
      tpl().hasResourceProperties('AWS::S3::BucketPolicy', {
        Bucket: { Ref: qid },
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Deny',
              Action: 's3:*',
              Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            }),
            Match.objectLike({
              Effect: 'Deny',
              Action: ['s3:GetObject', 's3:GetObjectVersion'],
              Condition: {
                StringNotEquals: { 's3:ExistingObjectTag/GuardDutyMalwareScanStatus': 'NO_THREATS_FOUND' },
                ArnNotEquals: { 'aws:PrincipalArn': Match.anyValue() },
              },
            }),
          ]),
        },
      });
    });
  });

  test('public-media bucket: SSE-KMS with the CMK; its policy (OAC + TLS) lives in the CDN stack', () => {
    const [id, b] = bucketByTag('media-public');
    expect(JSON.stringify(b.Properties?.BucketEncryption)).toContain('"SSEAlgorithm":"aws:kms"');
    const policies = Object.values(resourcesOfType(raw(), 'AWS::S3::BucketPolicy'));
    expect(policies.filter((p) => JSON.stringify(p.Properties?.Bucket) === JSON.stringify({ Ref: id }))).toEqual([]);
  });

  test('frontend-static bucket: SSE-S3, versioned (deploy rollback), old versions expire', () => {
    const [id, b] = bucketByTag('frontend-static');
    expect(JSON.stringify(b.Properties?.BucketEncryption)).toContain('"SSEAlgorithm":"AES256"');
    expect(b.Properties?.VersioningConfiguration).toEqual({ Status: 'Enabled' });
    expect(JSON.stringify(b.Properties?.LifecycleConfiguration)).toContain('NoncurrentVersionExpiration');
    const policies = Object.values(resourcesOfType(raw(), 'AWS::S3::BucketPolicy'));
    expect(policies.filter((p) => JSON.stringify(p.Properties?.Bucket) === JSON.stringify({ Ref: id }))).toEqual([]);
  });

  /**
   * EVENTS-002: the NBA dataset's four CSVs, uploaded by the human and read by
   * SportsDataLoad only. Private, CMK-encrypted, TLS only, and nothing else
   * about it: no versioning, no expiry, no events, no scanning, no origin.
   */
  describe('sports-data bucket (EVENTS-002)', () => {
    test('SSE-KMS with the CMK, not versioned, no lifecycle rule, no event notifications', () => {
      const [, b] = bucketByTag('sports-data');
      expect(JSON.stringify(b.Properties?.BucketEncryption)).toContain('"SSEAlgorithm":"aws:kms"');
      expect(JSON.stringify(b.Properties?.BucketEncryption)).toContain('KMSMasterKeyID');
      expect(b.Properties?.VersioningConfiguration).toBeUndefined();
      expect(b.Properties?.LifecycleConfiguration).toBeUndefined();
      expect(b.Properties?.NotificationConfiguration).toBeUndefined();
      expect(b.Properties?.CorsConfiguration).toBeUndefined();
    });

    test('same CMK as the quarantine bucket', () => {
      const keyOf = (purpose: string) =>
        JSON.stringify(
          (
            bucketByTag(purpose)[1].Properties?.BucketEncryption as {
              ServerSideEncryptionConfiguration: { ServerSideEncryptionByDefault: { KMSMasterKeyID: unknown } }[];
            }
          ).ServerSideEncryptionConfiguration[0]?.ServerSideEncryptionByDefault.KMSMasterKeyID,
        );
      expect(keyOf('sports-data')).toBe(keyOf('media-quarantine'));
    });

    test('its bucket policy is the TLS-only deny and nothing else', () => {
      const [id] = bucketByTag('sports-data');
      const policies = Object.values(resourcesOfType(raw(), 'AWS::S3::BucketPolicy')).filter(
        (p) => JSON.stringify(p.Properties?.Bucket) === JSON.stringify({ Ref: id }),
      );
      expect(policies).toHaveLength(1);
      const statements = (policies[0]?.Properties?.PolicyDocument as { Statement: Record<string, unknown>[] }).Statement;
      expect(statements).toEqual([
        expect.objectContaining({
          Effect: 'Deny',
          Action: 's3:*',
          Condition: { Bool: { 'aws:SecureTransport': 'false' } },
        }),
      ]);
    });

    test('no GuardDuty plan protects it', () => {
      const [id] = bucketByTag('sports-data');
      const plans = Object.values(resourcesOfType(raw(), 'AWS::GuardDuty::MalwareProtectionPlan'));
      expect(plans.length).toBeGreaterThan(0);
      for (const plan of plans) expect(JSON.stringify(plan)).not.toContain(`"${id}"`);
    });

    test('no other stack but App names it (no CloudFront origin, no deployment)', () => {
      const [id] = bucketByTag('sports-data');
      const s = synthFanwire();
      const naming = s
        .stackNames()
        .filter((stack) => stack !== STACK_NAMES.storage && JSON.stringify(s.json(stack)).includes(id));
      expect(naming).toEqual([STACK_NAMES.app]);
    });
  });

  describe('GuardDuty Malware Protection for S3', () => {
    test('one protection plan on the quarantine bucket uploads/ prefix, tagging scan results', () => {
      const [qid] = bucketByTag('media-quarantine');
      tpl().resourceCountIs('AWS::GuardDuty::MalwareProtectionPlan', 1);
      tpl().hasResourceProperties('AWS::GuardDuty::MalwareProtectionPlan', {
        ProtectedResource: { S3Bucket: { BucketName: { Ref: qid }, ObjectPrefixes: ['uploads/'] } },
        Actions: { Tagging: { Status: 'ENABLED' } },
        Role: Match.anyValue(),
      });
    });

    test('its own role, assumable only by the malware-protection-plan service principal from this account', () => {
      tpl().hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            Match.objectLike({
              Principal: { Service: 'malware-protection-plan.guardduty.amazonaws.com' },
              Action: 'sts:AssumeRole',
              Condition: { StringEquals: { 'aws:SourceAccount': '294321867941' } },
            }),
          ],
        },
      });
    });

    test('its role can read/tag quarantine objects and decrypt via S3 only', () => {
      tpl().hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({ Action: ['s3:GetObject', 's3:GetObjectVersion'] }),
            Match.objectLike({
              Action: ['kms:Decrypt', 'kms:GenerateDataKey'],
              Condition: { StringLike: { 'kms:ViaService': 's3.*.amazonaws.com' } },
            }),
          ]),
        },
      });
    });
  });

  test('no custom-resource Lambdas (no autoDeleteObjects, no CDK bucket-notification handler)', () => {
    tpl().resourceCountIs('AWS::Lambda::Function', 0);
    tpl().resourceCountIs('Custom::S3BucketNotifications', 0);
    tpl().resourceCountIs('Custom::S3AutoDeleteObjects', 0);
  });

  test('outputs bucket names', () => {
    const outputs = synthFanwire().json(STACK_NAMES.storage).Outputs ?? {};
    expect(Object.keys(outputs)).toEqual(
      expect.arrayContaining([
        'QuarantineBucketName',
        'PublicMediaBucketName',
        'FrontendBucketName',
        'SportsDataBucketName',
      ]),
    );
  });
});

describe.each(Object.entries(DOMAIN_MODES))('Storage stack CORS origin (%s)', (mode, overrides) => {
  test('quarantine CORS allows the site origin', () => {
    const synth = synthFanwire(overrides);
    const buckets = Object.values(resourcesOfType(synth.json(STACK_NAMES.storage), 'AWS::S3::Bucket'));
    const cors = JSON.stringify(buckets.map((b) => b.Properties?.CorsConfiguration).filter(Boolean));
    if (mode === 'no domain') {
      // the distribution's own *.cloudfront.net name isn't known before it exists
      expect(cors).toContain('"AllowedOrigins":["https://*.cloudfront.net"]');
    } else {
      expect(cors).toContain('"AllowedOrigins":["https://fanwire.daviddems.com"]');
    }
  });
});
