import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { AuthStack } from './auth-stack';
import { FanwireConfig } from './config';
import { DataStack } from './data-stack';
import { ALARM_PERIOD, CONSUMER_TIMEOUTS, MessagingStack, notifyAlarmTopic } from './messaging-stack';
import { NetworkStack } from './network-stack';
import { StorageStack } from './storage-stack';

export interface AppStackProps extends cdk.StackProps {
  readonly config: FanwireConfig;
  readonly network: NetworkStack;
  readonly data: DataStack;
  readonly auth: AuthStack;
  readonly storage: StorageStack;
  readonly messaging: MessagingStack;
  /** Messaging's alarm topic: every alarm in this stack sends ALARM and OK to it. */
  readonly alarmTopic: sns.ITopic;
}

/** Repo root: the Lambda image's Docker build context. */
const REPO_ROOT = path.join(__dirname, '..', '..');

/** The only request header CloudFront adds that execute-api checks for. */
export const ORIGIN_VERIFY_HEADER = 'x-origin-verify';

/**
 * Alarm thresholds. They start loose and are tightened from measurements
 * (16-performance-tests gives the latency baseline).
 */
export const ALARM_THRESHOLDS = {
  /** An absolute count, not a ratio: at today's traffic one error in two requests would be 50%. */
  api5xxPerPeriod: 5,
  /** Loose until the performance tests give a baseline; sustained over 3 of 3 periods. */
  apiLatencyP95Ms: 3000,
  apiLatencyP99Ms: 8000,
  /** At this volume one is worth an email, and an alarm emails on a state change, not every period. */
  lambdaErrorsPerPeriod: 1,
  lambdaThrottlesPerPeriod: 1,
  /** Sustained (3 of 3 periods), so one busy load or migration alone does not alarm. */
  rdsCpuPercent: 80,
  /** 10% of the instance's 20 GiB. */
  rdsFreeStorageBytes: 2 * 1024 ** 3,
  /** A t4g.micro allows roughly 80 to 110 connections: alarm well before the cap. */
  rdsConnections: 60,
} as const;

/**
 * Compute: the one shared backend Lambda image (build-deployment.md) run as
 * five functions, the HTTP API in front of the API function, and every
 * trigger (SQS event source mappings). Two functions -- the migration runner
 * and the sports data load -- are deliberately the target of no trigger at
 * all; see `migrationRunner()` and `sportsDataLoad()` below.
 *
 * The API-SPORTS ingestion function, its schedule, retry trigger and async
 * destination, and the API's live-score cache grant are gone (EVENTS-003).
 * The resources they used (Data's idempotency table, live-score cache table
 * and API-SPORTS secret; Messaging's ingestion-retry queue and DLQ) stay,
 * still exported by their own stacks, until a later infra unit removes them.
 * Every function has its own role with explicit, enumerated statements --
 * no grant*() helpers, no managed policies (see test/iam-policy.test.ts).
 */
export class AppStack extends cdk.Stack {
  readonly httpApi: apigwv2.HttpApi;

  private readonly props: AppStackProps;
  private readonly keyArn: string;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    this.props = props;
    const { config, data, auth, storage, messaging } = props;
    this.keyArn = data.key.keyArn;
    const keyRef = kms.Key.fromKeyArn(this, 'KeyRef', this.keyArn);

    // --- the single image. Context = repo root (the Dockerfile COPYs
    // backend/...), with everything except what it copies excluded so synth
    // doesn't stage node_modules, .git, frontend/ or infra/.
    const image = new ecrAssets.DockerImageAsset(this, 'BackendImage', {
      directory: REPO_ROOT,
      file: 'docker/backend.Dockerfile',
      target: 'lambda',
      platform: ecrAssets.Platform.LINUX_AMD64,
      ignoreMode: cdk.IgnoreMode.DOCKER,
      exclude: [
        '*',
        '!docker',
        'docker/*',
        '!docker/backend.Dockerfile',
        '!backend',
        'backend/*',
        '!backend/pyproject.toml',
        '!backend/app',
        // only the `test` stage copies these; kept so a non-BuildKit builder
        // (which doesn't skip unused stages) still finds them
        '!backend/tests',
        '!backend/alembic',
        '!backend/alembic.ini',
        '**/__pycache__',
        '**/*.pyc',
        '**/.pytest_cache',
      ],
    });

    // --- DATABASE_URL. Settings.database_url wants a full SQLAlchemy URL. The
    // password is a CloudFormation dynamic reference resolved at deploy time:
    // never in git or in the template. At rest it sits in the function's
    // environment encrypted with the CMK. (A later backend change can read
    // the secret at cold start instead and drop this; see wiki notes.)
    const dbSecret = data.databaseSecret;
    const databaseUrl = cdk.Fn.join('', [
      'postgresql+psycopg://',
      dbSecret.secretValueFromJson('username').unsafeUnwrap(),
      ':',
      dbSecret.secretValueFromJson('password').unsafeUnwrap(),
      '@',
      data.database.dbInstanceEndpointAddress,
      ':',
      data.database.dbInstanceEndpointPort,
      `/${DataStack.DATABASE_NAME}`,
    ]);

    const common = { DATABASE_URL: databaseUrl, POWERTOOLS_SERVICE_NAME: 'fanwire' };

    // --- API
    const api = this.backendFunction('Api', {
      command: 'app.main.handler',
      timeout: cdk.Duration.seconds(25), // under HTTP API's 30s integration cap
      memorySize: 512,
      image,
      keyRef,
      environment: {
        ...common,
        COGNITO_REGION: auth.region,
        COGNITO_USER_POOL_ID: auth.userPool.userPoolId,
        COGNITO_APP_CLIENT_ID: auth.userPoolClient.userPoolClientId,
        MEDIA_QUARANTINE_BUCKET: storage.quarantineBucket.bucketName,
        MEDIA_PUBLIC_BUCKET: storage.publicMediaBucket.bucketName,
        POST_EVENT_BUS_NAME: messaging.postEventBus.eventBusName,
      },
      statements: [
        // presigned PUT (app.media.routes signs with this role's credentials)
        new iam.PolicyStatement({
          sid: 'PresignQuarantineUploads',
          actions: ['s3:PutObject'],
          resources: [storage.quarantineBucket.arnForObjects(`${StorageStack.UPLOAD_PREFIX}*`)],
        }),
        this.kmsStatement('SseKmsForUploads', ['kms:GenerateDataKey']),
        this.putEventsStatement(),
      ],
    });

    // --- media processing (GuardDuty scan result -> SQS -> here)
    const media = this.backendFunction('Media', {
      command: 'app.media.lambda_handler.handler',
      timeout: CONSUMER_TIMEOUTS.media,
      memorySize: 1024, // Pillow decode/resize
      image,
      keyRef,
      environment: {
        ...common,
        MEDIA_QUARANTINE_BUCKET: storage.quarantineBucket.bucketName,
        MEDIA_PUBLIC_BUCKET: storage.publicMediaBucket.bucketName,
      },
      statements: [
        new iam.PolicyStatement({
          sid: 'ReadAndDeleteQuarantinedUploads',
          actions: ['s3:GetObject', 's3:GetObjectTagging', 's3:DeleteObject'],
          resources: [storage.quarantineBucket.arnForObjects(`${StorageStack.UPLOAD_PREFIX}*`)],
        }),
        new iam.PolicyStatement({
          // app.media.pipeline writes media/{id}/public.* and thumbnail.*
          sid: 'WriteProcessedMedia',
          actions: ['s3:PutObject'],
          resources: [storage.publicMediaBucket.arnForObjects('media/*')],
        }),
        this.kmsStatement('SseKmsWrite', ['kms:GenerateDataKey']),
        ...this.consumeQueueStatements('MediaScanResults', messaging.mediaScanResultQueue),
      ],
    });
    this.sqsTrigger('MediaScanResultTrigger', media, messaging.mediaScanResultQueue, 1);

    // --- notifications consumer (PostEventBus rule -> SQS -> here)
    const notificationStatements = [
      ...this.consumeQueueStatements('Notifications', messaging.notificationQueue),
      new iam.PolicyStatement({
        // resolve the recipient's email from Cognito by sub at send time (app.notifications.email)
        sid: 'LookUpRecipient',
        actions: ['cognito-idp:AdminGetUser'],
        resources: [auth.userPool.userPoolArn],
      }),
    ];
    const notificationEnv: Record<string, string> = {
      ...common,
      COGNITO_REGION: auth.region,
      COGNITO_USER_POOL_ID: auth.userPool.userPoolId,
    };
    if (config.domainName && config.hostedZoneId) {
      this.sesDomainIdentity(config.domainName, config.hostedZoneId, config.hostedZoneName);
    }
    // The SES sandbox rejects unverified recipients: no send grant or from-address until production access.
    if (config.domainName && config.sendEmailNotifications) {
      notificationStatements.push(
        new iam.PolicyStatement({
          sid: 'SendFromSiteDomain',
          actions: ['ses:SendEmail'],
          resources: [`arn:aws:ses:${this.region}:${this.account}:identity/${config.domainName}`],
        }),
      );
      notificationEnv.NOTIFICATION_FROM_ADDRESS = `notifications@${config.domainName}`;
    }
    const notifications = this.backendFunction('Notifications', {
      command: 'app.notifications.lambda_handler.handler',
      timeout: CONSUMER_TIMEOUTS.notifications,
      memorySize: 256,
      image,
      keyRef,
      environment: notificationEnv,
      statements: notificationStatements,
    });
    this.sqsTrigger('NotificationTrigger', notifications, messaging.notificationQueue, 10);

    // --- schema migrations, on demand only
    this.migrationRunner(image, keyRef, common);

    // --- the NBA dataset load, on demand only (EVENTS-002)
    this.sportsDataLoad(image, keyRef, common, storage.sportsDataBucket);

    // --- HTTP API, reachable only with CloudFront's origin-verify header.
    const authorizerFn = this.originVerifyAuthorizer(data);
    const accessLogs = new logs.LogGroup(this, 'HttpApiAccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      description: 'fanwire API (origin for CloudFront /api/*; direct calls rejected by the origin-verify authorizer)',
      createDefaultStage: false,
      defaultIntegration: new HttpLambdaIntegration('ApiIntegration', api),
      defaultAuthorizer: new HttpLambdaAuthorizer('OriginVerify', authorizerFn, {
        authorizerName: 'origin-verify',
        identitySource: [`$request.header.${ORIGIN_VERIFY_HEADER}`],
        responseTypes: [HttpLambdaResponseType.SIMPLE],
        resultsCacheTtl: cdk.Duration.minutes(5),
      }),
    });
    const stage = new apigwv2.HttpStage(this, 'DefaultStage', {
      httpApi: this.httpApi,
      stageName: '$default',
      autoDeploy: true,
      // Second layer behind WAF (security.md): account-wide caps for this API.
      throttle: { rateLimit: 50, burstLimit: 100 },
      accessLogSettings: { destination: new apigwv2.LogGroupLogDestination(accessLogs) },
    });

    new cdk.CfnOutput(this, 'HttpApiEndpoint', {
      value: `https://${this.httpApi.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
      description: 'Direct execute-api URL (CloudFront origin only; direct requests get 401/403)',
    });

    this.alarms(stage, data);
    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: props.alarmTopic.topicArn,
      description: 'Subscribe an address to this topic by hand to receive fanwire alarms (never committed)',
    });
  }

  /**
   * Alarms on the HTTP API stage, every Lambda function in this stack and the
   * RDS instance, all to Messaging's alarm topic (the DLQ alarms sit beside
   * their queues in Messaging). The function list is derived from the
   * construct tree, not listed, so a new function cannot ship unwatched.
   */
  private alarms(stage: apigwv2.HttpStage, data: DataStack): void {
    const t = ALARM_THRESHOLDS;
    const { GREATER_THAN_THRESHOLD: GT, GREATER_THAN_OR_EQUAL_TO_THRESHOLD: GTE } = cloudwatch.ComparisonOperator;
    const period = ALARM_PERIOD;

    this.alarm('Api5xxAlarm', 'HTTP API 5xx responses', {
      metric: stage.metricServerError({ statistic: 'Sum', period }),
      comparisonOperator: GTE,
      threshold: t.api5xxPerPeriod,
    });
    this.alarm('ApiLatencyP95Alarm', 'HTTP API p95 latency', {
      metric: stage.metricLatency({ statistic: 'p95', period }),
      comparisonOperator: GT,
      threshold: t.apiLatencyP95Ms,
      periods: 3,
    });
    this.alarm('ApiLatencyP99Alarm', 'HTTP API p99 latency', {
      metric: stage.metricLatency({ statistic: 'p99', period }),
      comparisonOperator: GT,
      threshold: t.apiLatencyP99Ms,
      periods: 3,
    });

    const functions = this.node.findAll().filter((c): c is lambda.Function => c instanceof lambda.Function);
    for (const fn of functions) {
      const id = fn.node.id;
      this.alarm(`${id}ErrorsAlarm`, `${id} Lambda errors`, {
        metric: fn.metricErrors({ statistic: 'Sum', period }),
        comparisonOperator: GTE,
        threshold: t.lambdaErrorsPerPeriod,
      });
      this.alarm(`${id}ThrottlesAlarm`, `${id} Lambda throttles`, {
        metric: fn.metricThrottles({ statistic: 'Sum', period }),
        comparisonOperator: GTE,
        threshold: t.lambdaThrottlesPerPeriod,
      });
    }

    const db = data.database;
    this.alarm('RdsCpuAlarm', 'RDS CPU utilization', {
      metric: db.metricCPUUtilization({ statistic: 'Average', period }),
      comparisonOperator: GT,
      threshold: t.rdsCpuPercent,
      periods: 3,
    });
    this.alarm('RdsFreeStorageAlarm', 'RDS free storage', {
      metric: db.metricFreeStorageSpace({ statistic: 'Minimum', period }),
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      threshold: t.rdsFreeStorageBytes,
    });
    this.alarm('RdsConnectionsAlarm', 'RDS connections', {
      metric: db.metricDatabaseConnections({ statistic: 'Maximum', period }),
      comparisonOperator: GT,
      threshold: t.rdsConnections,
    });
  }

  /** One alarm, `periods` of `periods` breaching (default 1), to the alarm topic. Missing data is not breaching. */
  private alarm(
    id: string,
    what: string,
    opts: {
      metric: cloudwatch.IMetric;
      comparisonOperator: cloudwatch.ComparisonOperator;
      threshold: number;
      periods?: number;
    },
  ): void {
    const periods = opts.periods ?? 1;
    const alarm = new cloudwatch.Alarm(this, id, {
      alarmDescription: `fanwire: ${what}`,
      metric: opts.metric,
      comparisonOperator: opts.comparisonOperator,
      threshold: opts.threshold,
      evaluationPeriods: periods,
      datapointsToAlarm: periods,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    notifyAlarmTopic(alarm, this.props.alarmTopic);
  }

  /**
   * The on-demand schema migration runner (`app.migrate.handler`).
   *
   * The same `DockerImageAsset` as the other three functions with a different
   * `cmd` override -- the `lambda` stage copies `alembic/` and `alembic.ini`,
   * so the code that migrates the schema is byte-for-byte the code that runs
   * against it. A second image would double the build, the ECR footprint and
   * the ways the two could drift apart.
   *
   * **Nothing invokes this.** No rule, no schedule, no event source mapping,
   * no CloudFormation custom resource: a human invokes it once after
   * `cdk deploy`, before the API is expected to work. DDL inside a stack
   * update would make every deploy a schema change, make rollback ambiguous
   * and put `alembic upgrade head` inside CloudFormation's timeout and
   * failure semantics. `test/app-stack.test.ts` sweeps every stack for an
   * invoker so that a later "improvement" wiring one up fails the build.
   *
   * **No reserved concurrency**, deliberately. This carried
   * `reservedConcurrentExecutions: 1` until the first real `cdk deploy`
   * (2026-09-29) failed on exactly that and rolled the whole stack back: AWS
   * caps a reservation at the account's concurrency limit minus 100, and the
   * workload account was at the new-account default of 10, so no function
   * there could reserve anything. It is staying off even once the quota is
   * raised, for two reasons -- a reservation couples this template to an
   * account-level quota, so it is undeployable in any account or region under
   * 101; and it was the weaker guarantee anyway, constraining only this
   * Lambda while `alembic upgrade head` also runs from the `dev` image's CMD
   * and from any shell with a DATABASE_URL. "One migration at a time" now
   * lives in Postgres, as an advisory lock in `app.migrate`.
   *
   * No extra statements beyond what `backendFunction` already gives every
   * function -- it needs its log group, the ENI actions for the VPC, and
   * `kms:Decrypt` for its encrypted environment, and nothing else:
   * DATABASE_URL is a CloudFormation dynamic reference resolved at deploy
   * time, not a Secrets Manager call at runtime.
   */
  private migrationRunner(
    image: ecrAssets.DockerImageAsset,
    keyRef: kms.IKey,
    environment: Record<string, string>,
  ): void {
    this.backendFunction('Migration', {
      command: 'app.migrate.handler',
      // Well clear of the longest plausible `alembic upgrade head` on a cold
      // database, and it is invoked by hand so nothing is waiting on it.
      timeout: cdk.Duration.minutes(10),
      memorySize: 512,
      image,
      keyRef,
      environment,
      statements: [],
    });
  }

  /**
   * The hand-invoked NBA dataset load (`app.events.load_handler.handler`,
   * EVENTS-002): downloads the four CSVs from the sports-data bucket and runs
   * the same loader as `scripts/load_nba_history.py`.
   *
   * The migration runner's pattern: the same image with another `cmd`, and
   * **nothing invokes it** -- the human does, after uploading the files
   * (build-deployment.md "Load sports data"). The invoker sweep in
   * `test/app-stack.test.ts` covers it. One load at a time is an advisory
   * lock in Postgres, as for migrations, not a concurrency reservation.
   *
   * Sized from the Director's measurement (2026-10-14, local Postgres): all
   * 23 seasons in 73-139 s at a 709 MB peak, one season in 18 s at 99 MB.
   * 2048 MB is about three times that peak and buys CPU; the four files are
   * ~440 MB, over the 512 MB of `/tmp` a function gets by default.
   *
   * One grant beyond backendFunction's three: `s3:GetObject` on the dataset
   * prefix. It knows the four file names, so no `s3:ListBucket`. The bucket
   * is encrypted with the CMK `DecryptEnvironmentAndData` already names.
   */
  private sportsDataLoad(
    image: ecrAssets.DockerImageAsset,
    keyRef: kms.IKey,
    common: Record<string, string>,
    bucket: s3.IBucket,
  ): void {
    this.backendFunction('SportsDataLoad', {
      command: 'app.events.load_handler.handler',
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
      image,
      keyRef,
      environment: { ...common, SPORTS_DATA_BUCKET: bucket.bucketName },
      statements: [
        new iam.PolicyStatement({
          sid: 'ReadSportsDataset',
          actions: ['s3:GetObject'],
          resources: [bucket.arnForObjects(`${StorageStack.SPORTS_DATA_PREFIX}*`)],
        }),
      ],
    });
  }

  /**
   * The SES identity the notifications grant names, verified with Easy DKIM.
   * Only with a hosted zone: without one nothing could publish the DKIM
   * records, and an identity that never verifies sends nothing anyway.
   *
   * `Identity.domain`, not `Identity.publicHostedZone`: the latter names the
   * identity after the zone, and the zone may be an apex above the site
   * domain. The three CNAMEs are therefore written here, the way CDK's own
   * zone path writes them -- straight from the GetAtt tokens, which SES
   * returns fully qualified, so no zone suffix is appended.
   */
  private sesDomainIdentity(domainName: string, hostedZoneId: string, hostedZoneName?: string): void {
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId,
      zoneName: hostedZoneName ?? domainName,
    });
    const identity = new ses.EmailIdentity(this, 'SiteDomainIdentity', {
      identity: ses.Identity.domain(domainName),
      dkimIdentity: ses.DkimIdentity.easyDkim(),
    });
    identity.dkimRecords.forEach((record, i) => {
      new route53.CfnRecordSet(this, `SiteDomainDkim${i + 1}`, {
        hostedZoneId: zone.hostedZoneId,
        name: record.name,
        type: 'CNAME',
        resourceRecords: [record.value],
        ttl: '1800',
      });
    });
  }

  /** One of the five functions running the shared image, with its own role and log group. */
  private backendFunction(
    id: string,
    opts: {
      command: string;
      timeout: cdk.Duration;
      memorySize: number;
      ephemeralStorageSize?: cdk.Size;
      image: ecrAssets.DockerImageAsset;
      keyRef: kms.IKey;
      environment: Record<string, string>;
      statements: iam.PolicyStatement[];
    },
  ): lambda.Function {
    const { network } = this.props;
    const logGroup = new logs.LogGroup(this, `${id}LogGroup`, {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, `${id}Role`, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: `fanwire ${id} Lambda`,
    });
    const policy = new iam.Policy(this, `${id}Policy`, {
      roles: [role],
      statements: [
        this.logStatement(logGroup),
        // AWS's AWSLambdaVPCAccessExecutionRole statement, inline. The
        // Describe* actions have no resource-level permissions and Lambda
        // validates the rest against Resource "*" at CreateFunction time.
        new iam.PolicyStatement({
          sid: 'VpcNetworkInterfaces',
          actions: [
            'ec2:CreateNetworkInterface',
            'ec2:DescribeNetworkInterfaces',
            'ec2:DescribeSubnets',
            'ec2:DeleteNetworkInterface',
            'ec2:AssignPrivateIpAddresses',
            'ec2:UnassignPrivateIpAddresses',
          ],
          resources: ['*'],
        }),
        // Environment variables are encrypted with the CMK.
        this.kmsStatement('DecryptEnvironmentAndData', ['kms:Decrypt']),
        ...opts.statements,
      ],
    });
    const fn = new lambda.Function(this, id, {
      code: lambda.Code.fromEcrImage(opts.image.repository, {
        tagOrDigest: opts.image.imageTag,
        cmd: [opts.command],
      }),
      handler: lambda.Handler.FROM_IMAGE,
      runtime: lambda.Runtime.FROM_IMAGE,
      architecture: lambda.Architecture.X86_64,
      role,
      logGroup,
      timeout: opts.timeout,
      memorySize: opts.memorySize,
      ephemeralStorageSize: opts.ephemeralStorageSize,
      environment: opts.environment,
      environmentEncryption: opts.keyRef,
      vpc: network.vpc,
      vpcSubnets: { subnetGroupName: NetworkStack.APP_SUBNETS },
      securityGroups: [network.lambdaSecurityGroup],
      allowPublicSubnet: false,
    });
    // The role's permissions must exist before the function is created
    // (Lambda validates the VPC permissions at CreateFunction).
    fn.node.addDependency(policy);
    return fn;
  }

  private logStatement(logGroup: logs.LogGroup): iam.PolicyStatement {
    return new iam.PolicyStatement({
      sid: 'OwnLogGroup',
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [logGroup.logGroupArn],
    });
  }

  private kmsStatement(sid: string, actions: string[]): iam.PolicyStatement {
    return new iam.PolicyStatement({ sid, actions, resources: [this.keyArn] });
  }

  private putEventsStatement(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      sid: 'PublishDomainEvents',
      actions: ['events:PutEvents'],
      resources: [this.props.messaging.postEventBus.eventBusArn],
    });
  }

  private consumeQueueStatements(sid: string, queue: sqs.IQueue): iam.PolicyStatement[] {
    return [
      new iam.PolicyStatement({
        sid: `Consume${sid}`,
        actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:ChangeMessageVisibility', 'sqs:GetQueueAttributes'],
        resources: [queue.queueArn],
      }),
    ];
  }

  private sqsTrigger(id: string, fn: lambda.IFunction, queue: sqs.IQueue, batchSize: number): void {
    new lambda.EventSourceMapping(this, id, {
      target: fn,
      eventSourceArn: queue.queueArn,
      batchSize,
      reportBatchItemFailures: true,
    });
  }

  /**
   * HTTP APIs have no resource policy and no WAF, so this is how direct
   * execute-api calls are refused: API Gateway requires the
   * `x-origin-verify` header (no header = 401 without invoking anything)
   * and this function compares it, in constant time, with the secret
   * CloudFront injects. Results are cached per header value for 5 minutes,
   * so CloudFront traffic almost never invokes it. Runs outside the VPC
   * (needs only Secrets Manager) and reads the secret at cold start, so the
   * value is in neither git, the template, nor this function's config.
   */
  private originVerifyAuthorizer(data: DataStack): lambda.Function {
    const logGroup = new logs.LogGroup(this, 'OriginVerifyLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, 'OriginVerifyRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'fanwire origin-verify authorizer',
    });
    const policy = new iam.Policy(this, 'OriginVerifyPolicy', {
      roles: [role],
      statements: [
        this.logStatement(logGroup),
        new iam.PolicyStatement({
          sid: 'ReadOriginVerifySecret',
          actions: ['secretsmanager:GetSecretValue'],
          resources: [data.originVerifySecret.secretArn],
        }),
        this.kmsStatement('DecryptOriginVerifySecret', ['kms:Decrypt']),
      ],
    });
    const fn = new lambda.Function(this, 'OriginVerifyAuthorizer', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(
        [
          'import hmac, os',
          'import boto3',
          '',
          '_expected = None',
          '',
          '',
          'def handler(event, context):',
          '    global _expected',
          '    if _expected is None:',
          "        _expected = boto3.client('secretsmanager').get_secret_value(",
          "            SecretId=os.environ['ORIGIN_VERIFY_SECRET_ARN'])['SecretString']",
          `    got = (event.get('headers') or {}).get('${ORIGIN_VERIFY_HEADER}', '')`,
          "    return {'isAuthorized': hmac.compare_digest(got.encode(), _expected.encode())}",
          '',
        ].join('\n'),
      ),
      role,
      logGroup,
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      environment: { ORIGIN_VERIFY_SECRET_ARN: data.originVerifySecret.secretArn },
    });
    fn.node.addDependency(policy);
    return fn;
  }
}
