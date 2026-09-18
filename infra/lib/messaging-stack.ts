import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface MessagingStackProps extends cdk.StackProps {
  readonly key: kms.IKey;
  readonly quarantineBucket: s3.IBucket;
}

/** Visibility timeouts are 6x the consuming Lambda's timeout (AWS's SQS-trigger guidance). */
export const CONSUMER_TIMEOUTS = {
  notifications: cdk.Duration.seconds(30),
  ingestion: cdk.Duration.minutes(5),
  media: cdk.Duration.seconds(60),
} as const;

/**
 * Async plumbing: the PostEventBus (EventBridge custom bus = the Observer
 * bus), the SQS queues that must survive a downstream outage (aws-stack.md
 * "Async / decoupling"), each with a DLQ, and the rules feeding them.
 * Consumers (Lambdas + event source mappings) live in the App stack.
 */
export class MessagingStack extends cdk.Stack {
  readonly postEventBus: events.EventBus;
  readonly notificationQueue: sqs.Queue;
  readonly ingestionRetryQueue: sqs.Queue;
  readonly ingestionDeadLetterQueue: sqs.Queue;
  readonly mediaScanResultQueue: sqs.Queue;

  private readonly keyRef: kms.IKey;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);
    // Imported handle: stops Queue/target helpers adding grants to the key policy.
    this.keyRef = kms.Key.fromKeyArn(this, 'KeyRef', props.key.keyArn);

    this.postEventBus = new events.EventBus(this, 'PostEventBus', {
      eventBusName: 'PostEventBus',
      description: 'fanwire domain events (PostCreated, PostMentionedEvent, PostReported, UserFollowed)',
    });

    // --- notifications: PostCreated / UserFollowed -> queue -> notifications consumer Lambda
    const notifications = this.queueWithDlq('Notification', 'notifications', CONSUMER_TIMEOUTS.notifications, 5);
    this.notificationQueue = notifications.queue;
    const notificationRule = new events.Rule(this, 'NotificationRule', {
      eventBus: this.postEventBus,
      description: 'Domain events that can produce a notification',
      eventPattern: { detailType: ['PostCreated', 'UserFollowed'] },
    });
    this.routeRuleToQueue(notificationRule, this.notificationQueue);

    // --- ingestion retries: failed async ingestion invocations land here (Lambda
    // on-failure destination) and are retried by the same Lambda; the DLQ also
    // receives schedules the Scheduler itself could not deliver.
    const ingestion = this.queueWithDlq('IngestionRetry', 'ingestion-retry', CONSUMER_TIMEOUTS.ingestion, 3);
    this.ingestionRetryQueue = ingestion.queue;
    this.ingestionDeadLetterQueue = ingestion.dlq;

    // --- media: GuardDuty scan result for a quarantine object -> queue -> media Lambda.
    // Triggered by the scan RESULT, not raw ObjectCreated, so processing can't
    // race the scan and never starts on an unscanned object.
    const media = this.queueWithDlq('MediaScanResult', 'media-scan-results', CONSUMER_TIMEOUTS.media, 3);
    this.mediaScanResultQueue = media.queue;
    const scanRule = new events.Rule(this, 'MalwareScanResultRule', {
      // GuardDuty publishes scan results to the account's default bus.
      description: 'GuardDuty Malware Protection scan results for the fanwire quarantine bucket',
      eventPattern: {
        source: ['aws.guardduty'],
        detailType: ['GuardDuty Malware Protection Object Scan Result'],
        detail: { s3ObjectDetails: { bucketName: [props.quarantineBucket.bucketName] } },
      },
    });
    this.routeRuleToQueue(scanRule, this.mediaScanResultQueue);
  }

  private queueWithDlq(id: string, purpose: string, consumerTimeout: cdk.Duration, maxReceiveCount: number) {
    const dlq = new sqs.Queue(this, `${id}Dlq`, {
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.keyRef,
      dataKeyReuse: cdk.Duration.hours(1),
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });
    cdk.Tags.of(dlq).add('purpose', `${purpose}-dlq`);
    const queue = new sqs.Queue(this, `${id}Queue`, {
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.keyRef,
      dataKeyReuse: cdk.Duration.hours(1),
      enforceSSL: true,
      visibilityTimeout: cdk.Duration.seconds(consumerTimeout.toSeconds() * 6),
      deadLetterQueue: { queue: dlq, maxReceiveCount },
    });
    cdk.Tags.of(queue).add('purpose', purpose);
    return { queue, dlq };
  }

  /**
   * Rule -> queue with an explicit, single-action queue policy statement
   * scoped to this rule's ARN. (The stock targets.SqsQueue helper also grants
   * GetQueueAttributes/GetQueueUrl, which EventBridge doesn't need.)
   */
  private routeRuleToQueue(rule: events.Rule, queue: sqs.Queue): void {
    rule.addTarget({ bind: () => ({ arn: queue.queueArn }) });
    queue.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowEventBridgeRule',
        principals: [new iam.ServicePrincipal('events.amazonaws.com')],
        actions: ['sqs:SendMessage'],
        resources: [queue.queueArn],
        conditions: { ArnEquals: { 'aws:SourceArn': rule.ruleArn } },
      }),
    );
  }
}
