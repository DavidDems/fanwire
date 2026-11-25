import { Match } from 'aws-cdk-lib/assertions';
import { STACK_NAMES, resourcesOfType, synthFanwire, CfnResource } from './helpers';

const tpl = () => synthFanwire().template(STACK_NAMES.messaging);
const raw = () => synthFanwire().json(STACK_NAMES.messaging);
const queues = () => resourcesOfType(raw(), 'AWS::SQS::Queue');

function queueId(purpose: string): string {
  const hit = Object.entries(queues()).find(([, q]) => JSON.stringify(q.Properties?.Tags ?? []).includes(`"Value":"${purpose}"`));
  if (!hit) throw new Error(`no queue tagged purpose=${purpose}`);
  return hit[0];
}

function ruleTargeting(qid: string): CfnResource {
  const rule = Object.values(resourcesOfType(raw(), 'AWS::Events::Rule')).find((r) =>
    JSON.stringify(r.Properties?.Targets).includes(`"${qid}","Arn"`),
  );
  if (!rule) throw new Error(`no rule targets ${qid}`);
  return rule;
}

describe('Messaging stack', () => {
  test('custom event bus PostEventBus (the Observer bus in gof-patterns.md)', () => {
    tpl().resourceCountIs('AWS::Events::EventBus', 1);
    tpl().hasResourceProperties('AWS::Events::EventBus', { Name: 'PostEventBus' });
  });

  test('two work queues, each with its own DLQ; everything CMK-encrypted', () => {
    expect(Object.keys(queues())).toHaveLength(4);
    for (const q of Object.values(queues())) expect(q.Properties?.KmsMasterKeyId).toBeDefined();
    for (const purpose of ['notifications', 'media-scan-results']) {
      const q = queues()[queueId(purpose)];
      const dlq = queueId(`${purpose}-dlq`);
      expect(q?.Properties?.RedrivePolicy).toEqual({
        deadLetterTargetArn: { 'Fn::GetAtt': [dlq, 'Arn'] },
        maxReceiveCount: expect.any(Number),
      });
      expect(queues()[dlq]?.Properties?.MessageRetentionPeriod).toBe(1209600);
    }
  });

  test('PostCreated / UserFollowed on PostEventBus -> notification queue', () => {
    const rule = ruleTargeting(queueId('notifications'));
    expect(rule.Properties?.EventBusName).toEqual({ Ref: expect.stringMatching(/PostEventBus/) });
    expect(rule.Properties?.EventPattern).toEqual({ 'detail-type': ['PostCreated', 'UserFollowed'] });
  });

  test('GuardDuty malware scan results for the quarantine bucket (default bus) -> media queue', () => {
    const rule = ruleTargeting(queueId('media-scan-results'));
    expect(rule.Properties?.EventBusName).toBeUndefined(); // default bus: where GuardDuty publishes
    expect(rule.Properties?.EventPattern).toEqual({
      source: ['aws.guardduty'],
      'detail-type': ['GuardDuty Malware Protection Object Scan Result'],
      detail: { s3ObjectDetails: { bucketName: [expect.anything()] } },
    });
  });

  test('queue policies: EventBridge may SendMessage only from the one rule that targets that queue', () => {
    for (const purpose of ['notifications', 'media-scan-results']) {
      const qid = queueId(purpose);
      tpl().hasResourceProperties('AWS::SQS::QueuePolicy', {
        Queues: [{ Ref: qid }],
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Principal: { Service: 'events.amazonaws.com' },
              Action: 'sqs:SendMessage',
              Resource: { 'Fn::GetAtt': [qid, 'Arn'] },
              Condition: { ArnEquals: { 'aws:SourceArn': Match.anyValue() } },
            }),
          ]),
        },
      });
    }
  });

  test('every queue refuses non-TLS access', () => {
    const policies = Object.values(resourcesOfType(raw(), 'AWS::SQS::QueuePolicy'));
    const covered = new Set(
      policies
        .filter((p) => JSON.stringify(p.Properties?.PolicyDocument).includes('aws:SecureTransport'))
        .flatMap((p) => (p.Properties?.Queues as { Ref: string }[]).map((q) => q.Ref)),
    );
    expect([...covered].sort()).toEqual(Object.keys(queues()).sort());
  });

  test('no Lambda functions here (consumers live in the App stack)', () => {
    tpl().resourceCountIs('AWS::Lambda::Function', 0);
  });
});

/**
 * INFRA-005: the ingestion-retry queue, its DLQ, their policies, the DLQ's alarm
 * and the two exports are gone; the two remaining queues keep their logical ids.
 */
describe('Messaging stack: ingestion-retry queue and DLQ are gone (INFRA-005)', () => {
  const outputs = () => (raw().Outputs ?? {}) as Record<string, { Value?: unknown; Export?: { Name?: unknown } }>;

  test.each([
    'IngestionRetryQueueD528F9A2',
    'IngestionRetryDlqAD1363B6',
    'IngestionRetryQueuePolicy60151471',
    'IngestionRetryDlqPolicy72728599',
    'IngestionRetryDlqDepthAlarm7CDD189B',
  ])('%s no longer synthesizes', (logicalId) => {
    expect(Object.keys(raw().Resources ?? {})).not.toContain(logicalId);
  });

  test.each([
    'ExportsOutputFnGetAttIngestionRetryQueueD528F9A2Arn07FDF528',
    'ExportsOutputFnGetAttIngestionRetryDlqAD1363B6Arn3F8A5660',
  ])('output %s is gone', (outputId) => {
    expect(Object.keys(outputs())).not.toContain(outputId);
  });

  test('the notification and media-scan-result queues and DLQs keep their logical ids', () => {
    expect(Object.keys(queues()).sort()).toEqual(
      ['MediaScanResultDlqA8B08F5C', 'MediaScanResultQueue9CA01DAB', 'NotificationDlq467FCAE6', 'NotificationQueue36610CC1'].sort(),
    );
    expect(queueId('notifications')).toBe('NotificationQueue36610CC1');
    expect(queueId('media-scan-results')).toBe('MediaScanResultQueue9CA01DAB');
  });
});
