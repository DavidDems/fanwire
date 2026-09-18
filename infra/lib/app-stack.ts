import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { AuthStack } from './auth-stack';
import { FanwireConfig } from './config';
import { DataStack } from './data-stack';
import { CONSUMER_TIMEOUTS, MessagingStack } from './messaging-stack';
import { NetworkStack } from './network-stack';
import { StorageStack } from './storage-stack';

export interface AppStackProps extends cdk.StackProps {
  readonly config: FanwireConfig;
  readonly network: NetworkStack;
  readonly data: DataStack;
  readonly auth: AuthStack;
  readonly storage: StorageStack;
  readonly messaging: MessagingStack;
}

/** Repo root: the Lambda image's Docker build context. */
const REPO_ROOT = path.join(__dirname, '..', '..');

/** The only request header CloudFront adds that execute-api checks for. */
export const ORIGIN_VERIFY_HEADER = 'x-origin-verify';

/**
 * Compute: the one shared backend Lambda image (build-deployment.md) run as
 * four functions, the HTTP API in front of the API function, and every
 * trigger (Scheduler, SQS event source mappings, async-failure destination).
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
        LIVE_SCORE_CACHE_TABLE_NAME: data.liveScoreCacheTable.tableName,
      },
      statements: [
        // presigned PUT (app.media.routes signs with this role's credentials)
        new iam.PolicyStatement({
          sid: 'PresignQuarantineUploads',
          actions: ['s3:PutObject'],
          resources: [storage.quarantineBucket.arnForObjects(`${StorageStack.UPLOAD_PREFIX}*`)],
        }),
        this.kmsStatement('SseKmsForUploads', ['kms:GenerateDataKey']),
        new iam.PolicyStatement({
          sid: 'LiveScoreCache',
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
          resources: [data.liveScoreCacheTable.tableArn],
        }),
        this.putEventsStatement(),
      ],
    });

    // --- ingestion (EventBridge Scheduler + retry queue)
    const ingestion = this.backendFunction('Ingestion', {
      command: 'app.events.lambda_handler.handler',
      timeout: CONSUMER_TIMEOUTS.ingestion,
      memorySize: 512,
      image,
      keyRef,
      environment: {
        ...common,
        API_SPORTS_SECRET_ARN: data.apiSportsSecret.secretArn,
        IDEMPOTENCY_TABLE_NAME: data.idempotencyTable.tableName,
        LIVE_SCORE_CACHE_TABLE_NAME: data.liveScoreCacheTable.tableName,
        POST_EVENT_BUS_NAME: messaging.postEventBus.eventBusName,
      },
      statements: [
        new iam.PolicyStatement({
          sid: 'ReadApiSportsKey',
          actions: ['secretsmanager:GetSecretValue'],
          resources: [data.apiSportsSecret.secretArn],
        }),
        new iam.PolicyStatement({
          // aws-lambda-powertools Idempotency's calls
          sid: 'IdempotencyTable',
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
          resources: [data.idempotencyTable.tableArn],
        }),
        new iam.PolicyStatement({
          sid: 'LiveScoreCache',
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
          resources: [data.liveScoreCacheTable.tableArn],
        }),
        this.putEventsStatement(),
        ...this.consumeQueueStatements('IngestionRetry', messaging.ingestionRetryQueue),
        new iam.PolicyStatement({
          // Lambda's async on-failure destination is sent with the function's role
          sid: 'SendToIngestionRetryQueue',
          actions: ['sqs:SendMessage'],
          resources: [messaging.ingestionRetryQueue.queueArn],
        }),
        this.kmsStatement('SqsSend', ['kms:GenerateDataKey']),
      ],
    });
    new lambda.CfnEventInvokeConfig(this, 'IngestionAsyncConfig', {
      functionName: ingestion.functionName,
      qualifier: '$LATEST',
      maximumRetryAttempts: 2,
      destinationConfig: { onFailure: { destination: messaging.ingestionRetryQueue.queueArn } },
    });
    this.sqsTrigger('IngestionRetryTrigger', ingestion, messaging.ingestionRetryQueue, 1);
    this.ingestionSchedule(ingestion, messaging.ingestionDeadLetterQueue);

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
    if (config.domainName) {
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
    new apigwv2.HttpStage(this, 'DefaultStage', {
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
  }

  /** One of the four functions running the shared image, with its own role and log group. */
  private backendFunction(
    id: string,
    opts: {
      command: string;
      timeout: cdk.Duration;
      memorySize: number;
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

  private ingestionSchedule(ingestion: lambda.Function, dlq: sqs.IQueue): void {
    const role = new iam.Role(this, 'IngestionScheduleRole', {
      description: 'EventBridge Scheduler: invoke the fanwire ingestion Lambda',
      assumedBy: new iam.PrincipalWithConditions(new iam.ServicePrincipal('scheduler.amazonaws.com'), {
        StringEquals: { 'aws:SourceAccount': this.account },
      }),
    });
    const policy = new iam.Policy(this, 'IngestionSchedulePolicy', {
      roles: [role],
      statements: [
        new iam.PolicyStatement({
          sid: 'InvokeIngestion',
          actions: ['lambda:InvokeFunction'],
          resources: [ingestion.functionArn],
        }),
        new iam.PolicyStatement({
          sid: 'DeadLetter',
          actions: ['sqs:SendMessage'],
          resources: [dlq.queueArn],
        }),
        this.kmsStatement('EncryptDeadLetter', ['kms:GenerateDataKey', 'kms:Decrypt']),
      ],
    });
    const schedule = new scheduler.CfnSchedule(this, 'IngestionSchedule', {
      description: 'Baseline hourly sports-data ingestion (aws-stack.md: hourly outside live-game windows)',
      scheduleExpression: 'rate(1 hour)',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: ingestion.functionArn,
        roleArn: role.roleArn,
        input: JSON.stringify({ trigger: 'schedule', mode: 'baseline' }),
        retryPolicy: { maximumRetryAttempts: 2, maximumEventAgeInSeconds: 3600 },
        deadLetterConfig: { arn: dlq.queueArn },
      },
    });
    schedule.node.addDependency(policy);
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
