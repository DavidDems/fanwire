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

  test('three work queues, each with its own DLQ; everything CMK-encrypted', () => {
    expect(Object.keys(queues())).toHaveLength(6);
    for (const q of Object.values(queues())) expect(q.Properties?.KmsMasterKeyId).toBeDefined();
    for (const purpose of ['notifications', 'ingestion-retry', 'media-scan-results']) {
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
