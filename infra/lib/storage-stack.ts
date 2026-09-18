import * as cdk from 'aws-cdk-lib';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { FanwireConfig } from './config';

export interface StorageStackProps extends cdk.StackProps {
  readonly config: FanwireConfig;
  readonly key: kms.IKey;
}

/**
 * The three buckets and the GuardDuty Malware Protection plan on the
 * quarantine bucket.
 *
 * The public-media and frontend buckets deliberately get NO bucket policy
 * here: their only policy (CloudFront OAC read + TLS-only) must name the
 * distribution ARN, and the distribution (CDN stack) depends on the API
 * (App stack), which depends on these buckets -- so the CDN stack owns those
 * two BucketPolicy resources to keep the stack graph acyclic.
 */
export class StorageStack extends cdk.Stack {
  readonly quarantineBucket: s3.Bucket;
  readonly publicMediaBucket: s3.Bucket;
  readonly frontendBucket: s3.Bucket;
  readonly malwareProtectionRole: iam.Role;

  /** Key prefix the backend presigns uploads under (app.media.routes: `uploads/{id}/original.{ext}`). */
  static readonly UPLOAD_PREFIX = 'uploads/';

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);
    const { config } = props;
    // Imported handle: stops Bucket from appending grant statements to the key policy.
    const key = kms.Key.fromKeyArn(this, 'KeyRef', props.key.keyArn);

    const common: s3.BucketProps = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    };

    // --- quarantine: upload target only, never a CloudFront origin, never public.
    this.quarantineBucket = new s3.Bucket(this, 'QuarantineBucket', {
      ...common,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      bucketKeyEnabled: true,
      enforceSSL: true,
      // No versioning: a deleted (malicious or rejected) upload must actually be gone,
      // not kept as a noncurrent version (aws-stack.md "nothing that fails ... is kept").
      versioned: false,
      lifecycleRules: [
        // Objects only live here between upload and processing.
        { id: 'expire-unprocessed-uploads', expiration: cdk.Duration.days(1) },
        { id: 'abort-incomplete-multipart', abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) },
      ],
      cors: [
        {
          // The backend presigns a PUT with a fixed Content-Type (app.media.routes).
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: [config.domainName ? `https://${config.domainName}` : 'https://*.cloudfront.net'],
          allowedHeaders: ['Content-Type'],
          maxAge: 3000,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    cdk.Tags.of(this.quarantineBucket).add('purpose', 'media-quarantine');

    // --- public media: processed variants only, served via CloudFront OAC at /media/*.
    this.publicMediaBucket = new s3.Bucket(this, 'PublicMediaBucket', {
      ...common,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      bucketKeyEnabled: true,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    cdk.Tags.of(this.publicMediaBucket).add('purpose', 'media-public');

    // --- frontend static bundle. SSE-S3, not the CMK: the contents are the
    // public JS/CSS/HTML build output (no customer data, served to anyone),
    // and SSE-KMS would add a KMS request charge to every CloudFront cache
    // miss for zero confidentiality gain.
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      ...common,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      lifecycleRules: [{ id: 'expire-old-bundles', noncurrentVersionExpiration: cdk.Duration.days(30) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    cdk.Tags.of(this.frontendBucket).add('purpose', 'frontend-static');

    // --- GuardDuty Malware Protection for S3 on the quarantine bucket.
    this.malwareProtectionRole = new iam.Role(this, 'MalwareProtectionRole', {
      description: 'GuardDuty Malware Protection for S3: scan + tag objects in the fanwire quarantine bucket',
      assumedBy: new iam.PrincipalWithConditions(
        new iam.ServicePrincipal('malware-protection-plan.guardduty.amazonaws.com'),
        { StringEquals: { 'aws:SourceAccount': this.account } },
      ),
    });
    const managedRuleArn = `arn:aws:events:${this.region}:${this.account}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`;
    const bucketArn = this.quarantineBucket.bucketArn;
    const objectsArn = this.quarantineBucket.arnForObjects('*');
    // Statement set from https://docs.aws.amazon.com/guardduty/latest/ug/malware-protection-s3-iam-policy-prerequisite.html
    const gdPolicy = new iam.Policy(this, 'MalwareProtectionPolicy', {
      roles: [this.malwareProtectionRole],
      statements: [
        new iam.PolicyStatement({
          sid: 'ManageOwnEventBridgeRule',
          actions: ['events:PutRule', 'events:DeleteRule', 'events:PutTargets', 'events:RemoveTargets'],
          resources: [managedRuleArn],
          conditions: { StringLike: { 'events:ManagedBy': 'malware-protection-plan.guardduty.amazonaws.com' } },
        }),
        new iam.PolicyStatement({
          sid: 'DescribeOwnEventBridgeRule',
          actions: ['events:DescribeRule', 'events:ListTargetsByRule'],
          resources: [managedRuleArn],
        }),
        new iam.PolicyStatement({
          sid: 'TagScanResults',
          actions: [
            's3:GetObjectTagging',
            's3:GetObjectVersionTagging',
            's3:PutObjectTagging',
            's3:PutObjectVersionTagging',
          ],
          resources: [objectsArn],
        }),
        new iam.PolicyStatement({
          sid: 'EnableBucketEventBridgeNotifications',
          actions: ['s3:GetBucketNotification', 's3:PutBucketNotification'],
          resources: [bucketArn],
        }),
        new iam.PolicyStatement({
          sid: 'PutValidationObject',
          actions: ['s3:PutObject'],
          resources: [this.quarantineBucket.arnForObjects('malware-protection-resource-validation-object')],
        }),
        new iam.PolicyStatement({
          sid: 'CheckBucketOwnership',
          actions: ['s3:ListBucket'],
          resources: [bucketArn],
        }),
        new iam.PolicyStatement({
          sid: 'ReadObjectsToScan',
          actions: ['s3:GetObject', 's3:GetObjectVersion'],
          resources: [objectsArn],
        }),
        new iam.PolicyStatement({
          sid: 'DecryptObjectsToScan',
          actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
          resources: [props.key.keyArn],
          conditions: { StringLike: { 'kms:ViaService': 's3.*.amazonaws.com' } },
        }),
      ],
    });

    // Defence in depth: nobody but GuardDuty can read an upload until
    // GuardDuty has tagged it clean. The media Lambda only ever reads
    // objects after a NO_THREATS_FOUND scan result, so this never blocks it.
    this.quarantineBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyReadUntilScannedClean',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:GetObject', 's3:GetObjectVersion'],
        resources: [objectsArn],
        conditions: {
          StringNotEquals: { 's3:ExistingObjectTag/GuardDutyMalwareScanStatus': 'NO_THREATS_FOUND' },
          ArnNotEquals: { 'aws:PrincipalArn': this.malwareProtectionRole.roleArn },
        },
      }),
    );

    const plan = new guardduty.CfnMalwareProtectionPlan(this, 'MalwareProtectionPlan', {
      role: this.malwareProtectionRole.roleArn,
      protectedResource: {
        s3Bucket: {
          bucketName: this.quarantineBucket.bucketName,
          objectPrefixes: [StorageStack.UPLOAD_PREFIX],
        },
      },
      // Adds GuardDutyMalwareScanStatus=<result> to each scanned object; the
      // bucket policy above keys off it.
      actions: { tagging: { status: 'ENABLED' } },
    });
    plan.node.addDependency(gdPolicy);

    new cdk.CfnOutput(this, 'QuarantineBucketName', {
      value: this.quarantineBucket.bucketName,
      description: 'MEDIA_QUARANTINE_BUCKET',
    });
    new cdk.CfnOutput(this, 'PublicMediaBucketName', {
      value: this.publicMediaBucket.bucketName,
      description: 'MEDIA_PUBLIC_BUCKET',
    });
    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.frontendBucket.bucketName,
      description: 'Target of `aws s3 sync dist/` for the SPA build',
    });
  }
}
