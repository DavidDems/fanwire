import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { NetworkStack } from './network-stack';

export interface DataStackProps extends cdk.StackProps {
  readonly network: NetworkStack;
}

/**
 * Stateful, rarely-changing resources: the one customer-managed KMS key,
 * RDS Postgres (system of record), the two DynamoDB tables, and the
 * secrets. Kept apart from compute so a routine app deploy never touches
 * (or risks replacing) anything holding data.
 */
export class DataStack extends cdk.Stack {
  /** The one CMK (security.md "Data protection"). */
  readonly key: kms.Key;
  readonly database: rds.DatabaseInstance;
  readonly databaseSecret: secretsmanager.ISecret;
  readonly idempotencyTable: dynamodb.Table;
  readonly liveScoreCacheTable: dynamodb.Table;
  /** API-SPORTS key. Placeholder value; a human sets the real one. Ingestion role only. */
  readonly apiSportsSecret: secretsmanager.Secret;
  /** Shared secret CloudFront sends to the API origin; see AppStack's origin-verify authorizer. */
  readonly originVerifySecret: secretsmanager.Secret;

  static readonly DATABASE_NAME = 'fanwire';

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { network } = props;

    this.key = new kms.Key(this, 'Key', {
      alias: 'alias/fanwire',
      description: 'fanwire customer-managed key: RDS, S3 (quarantine + public media), DynamoDB, SQS, Secrets Manager',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      policy: this.keyPolicy(),
    });

    // Everything below references the key through an imported handle. L2
    // constructs (Secret in particular) otherwise "helpfully" call
    // key.grant*() and append statements with wildcard actions
    // (kms:GenerateDataKey*, kms:ReEncrypt*) to the key policy. Those are
    // redundant anyway: the key policy delegates to IAM, and every role that
    // uses the key gets explicit, enumerated kms: actions in its own policy.
    const keyRef = kms.Key.fromKeyArn(this, 'KeyRef', this.key.keyArn);

    this.database = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc: network.vpc,
      vpcSubnets: { subnetGroupName: NetworkStack.DATA_SUBNETS },
      securityGroups: [network.databaseSecurityGroup],
      multiAz: false,
      publiclyAccessible: false,
      databaseName: DataStack.DATABASE_NAME,
      credentials: rds.Credentials.fromGeneratedSecret('fanwire_admin', { encryptionKey: keyRef }),
      storageEncrypted: true,
      storageEncryptionKey: keyRef,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      autoMinorVersionUpgrade: true,
      enablePerformanceInsights: false,
    });
    this.databaseSecret = this.database.secret!;

    this.idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
      // aws-lambda-powertools Idempotency's default schema.
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expiration',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: keyRef,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.liveScoreCacheTable = new dynamodb.Table(this, 'LiveScoreCacheTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expires_at',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: keyRef,
      // Disposable cache (aws-stack.md "Data"): not a source of truth.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.apiSportsSecret = new secretsmanager.Secret(this, 'ApiSportsKey', {
      description:
        'API-SPORTS (api-sports.io) API key. Created with a random placeholder; a human sets the real key with ' +
        '`aws secretsmanager put-secret-value`. Readable by the ingestion Lambda role only.',
      encryptionKey: keyRef,
      generateSecretString: { passwordLength: 32, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.originVerifySecret = new secretsmanager.Secret(this, 'OriginVerify', {
      description:
        'CloudFront origin-verify header value. CloudFront adds it to every /api/* origin request; the HTTP API ' +
        'authorizer rejects requests without it, so execute-api cannot be called directly.',
      encryptionKey: keyRef,
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private keyPolicy(): iam.PolicyDocument {
    const account = this.account;
    return new iam.PolicyDocument({
      statements: [
        // Delegate to IAM (the standard account-root statement), but with the
        // actions enumerated instead of kms:*. Every principal that uses the
        // key still needs its own IAM policy naming the exact actions.
        new iam.PolicyStatement({
          sid: 'AccountRootDelegation',
          principals: [new iam.AccountRootPrincipal()],
          actions: [
            // administration (keeps the account able to manage the key; avoids lockout)
            'kms:CancelKeyDeletion',
            'kms:DescribeKey',
            'kms:DisableKey',
            'kms:DisableKeyRotation',
            'kms:EnableKey',
            'kms:EnableKeyRotation',
            'kms:GetKeyPolicy',
            'kms:GetKeyRotationStatus',
            'kms:ListGrants',
            'kms:ListKeyPolicies',
            'kms:ListResourceTags',
            'kms:PutKeyPolicy',
            'kms:RotateKeyOnDemand',
            'kms:ScheduleKeyDeletion',
            'kms:TagResource',
            'kms:UntagResource',
            'kms:UpdateKeyDescription',
            'kms:CreateAlias',
            'kms:DeleteAlias',
            'kms:UpdateAlias',
            // usage (RDS/DynamoDB/Secrets Manager create grants on the caller's behalf)
            'kms:CreateGrant',
            'kms:RetireGrant',
            'kms:RevokeGrant',
            'kms:Decrypt',
            'kms:Encrypt',
            'kms:GenerateDataKey',
            'kms:GenerateDataKeyWithoutPlaintext',
            'kms:ReEncryptFrom',
            'kms:ReEncryptTo',
          ],
          resources: ['*'],
        }),
        // CloudFront OAC reads SSE-KMS objects from the public-media bucket.
        // Scoped to distributions in this account rather than the exact
        // distribution ARN: the distribution lives in the CDN stack, which
        // depends on this one, so naming it here would be a dependency cycle.
        new iam.PolicyStatement({
          sid: 'CloudFrontOacDecryptPublicMedia',
          principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
          actions: ['kms:Decrypt'],
          resources: ['*'],
          conditions: {
            StringEquals: { 'aws:SourceAccount': account },
            ArnLike: { 'aws:SourceArn': `arn:aws:cloudfront::${account}:distribution/*` },
          },
        }),
        // EventBridge rules delivering into the CMK-encrypted SQS queues.
        // Same cycle reasoning: the rules live in the messaging stack.
        new iam.PolicyStatement({
          sid: 'EventBridgeToEncryptedSqs',
          principals: [new iam.ServicePrincipal('events.amazonaws.com')],
          actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
          resources: ['*'],
          conditions: {
            StringEquals: { 'aws:SourceAccount': account },
            ArnLike: { 'aws:SourceArn': `arn:aws:events:${this.region}:${account}:rule/*` },
          },
        }),
      ],
    });
  }
}
