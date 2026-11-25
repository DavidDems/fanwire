import { STACK_NAMES, resourcesOfType, synthFanwire, CfnResource } from './helpers';

// INFRA-009: a GuardDuty finding of severity >= 4 emails through AlarmTopic.

type Statement = {
  Sid?: string;
  Effect?: string;
  Principal?: { Service?: string | string[] };
  Action?: string | string[];
  Resource?: unknown;
  Condition?: Record<string, Record<string, unknown>>;
};

const raw = () => synthFanwire().json(STACK_NAMES.messaging);

function topicId(): string {
  const ids = Object.keys(resourcesOfType(raw(), 'AWS::SNS::Topic')).filter((id) => id.startsWith('AlarmTopic'));
  expect(ids).toHaveLength(1);
  return ids[0] as string;
}

function findingRules(): [string, CfnResource][] {
  return Object.entries(resourcesOfType(raw(), 'AWS::Events::Rule')).filter(([, r]) =>
    JSON.stringify(r.Properties?.EventPattern ?? {}).includes('"GuardDuty Finding"'),
  );
}

function findingRule(): [string, CfnResource] {
  const rules = findingRules();
  expect(rules).toHaveLength(1);
  return rules[0] as [string, CfnResource];
}

function topicStatements(): Statement[] {
  const id = topicId();
  return Object.values(resourcesOfType(raw(), 'AWS::SNS::TopicPolicy'))
    .filter((p) => JSON.stringify(p.Properties?.Topics).includes(`"Ref":"${id}"`))
    .flatMap((p) => (p.Properties?.PolicyDocument as { Statement: Statement[] }).Statement);
}

const services = (st: Statement): string[] => {
  const s = st.Principal?.Service;
  return s === undefined ? [] : Array.isArray(s) ? s : [s];
};
const actions = (st: Statement): string[] => (st.Action === undefined ? [] : Array.isArray(st.Action) ? st.Action : [st.Action]);

describe('GuardDuty findings rule (INFRA-009)', () => {
  test('exactly one rule matches GuardDuty Finding, on the default bus, enabled', () => {
    const [id, rule] = findingRule();
    expect(id).toMatch(/^GuardDutyFindingRule/);
    expect(rule.Properties?.EventBusName).toBeUndefined();
    expect(rule.Properties?.State).toBe('ENABLED');
  });

  test('pattern: aws.guardduty, GuardDuty Finding, severity >= 4 (Medium, High and Critical)', () => {
    const [, rule] = findingRule();
    expect(rule.Properties?.EventPattern).toEqual({
      source: ['aws.guardduty'],
      'detail-type': ['GuardDuty Finding'],
      detail: { severity: [{ numeric: ['>=', 4] }] },
    });
  });

  test('one target: the alarm topic, no role, a readable input transformer', () => {
    const [, rule] = findingRule();
    const targets = rule.Properties?.Targets as Record<string, unknown>[];
    expect(targets).toHaveLength(1);
    const target = targets[0] as {
      Arn?: unknown;
      RoleArn?: unknown;
      InputTransformer?: { InputPathsMap?: Record<string, string>; InputTemplate?: string };
    };
    expect(target.Arn).toEqual({ Ref: topicId() });
    expect(target.RoleArn).toBeUndefined();
    const paths = Object.values(target.InputTransformer?.InputPathsMap ?? {}).sort();
    expect(paths).toEqual(
      ['$.account', '$.detail.id', '$.detail.severity', '$.detail.title', '$.detail.type', '$.region'].sort(),
    );
    const template = target.InputTransformer?.InputTemplate ?? '';
    for (const key of Object.keys(target.InputTransformer?.InputPathsMap ?? {})) {
      expect(template).toContain(`<${key}>`);
    }
    expect(template).toContain('GuardDuty');
  });

  test('topic policy: EventBridge may publish only from the findings rule', () => {
    const [ruleId] = findingRule();
    const st = topicStatements().find((s) => s.Sid === 'AllowEventBridgeGuardDutyFindings');
    expect(st).toEqual({
      Sid: 'AllowEventBridgeGuardDutyFindings',
      Effect: 'Allow',
      Principal: { Service: 'events.amazonaws.com' },
      Action: 'sns:Publish',
      Resource: { Ref: topicId() },
      Condition: { ArnEquals: { 'aws:SourceArn': { 'Fn::GetAtt': [ruleId, 'Arn'] } } },
    });
  });

  test('no statement lets EventBridge publish without an aws:SourceArn condition', () => {
    const open = topicStatements().filter(
      (s) =>
        s.Effect === 'Allow' &&
        services(s).includes('events.amazonaws.com') &&
        actions(s).includes('sns:Publish') &&
        !JSON.stringify(s.Condition ?? {}).includes('"aws:SourceArn"'),
    );
    expect(open).toEqual([]);
  });

  test('AllowCloudWatchAlarms is unchanged', () => {
    const st = topicStatements().find((s) => s.Sid === 'AllowCloudWatchAlarms');
    expect(st?.Effect).toBe('Allow');
    expect(st?.Principal).toEqual({ Service: 'cloudwatch.amazonaws.com' });
    expect(st?.Action).toBe('sns:Publish');
    expect(st?.Resource).toEqual({ Ref: topicId() });
    expect(Object.keys(st?.Condition ?? {}).sort()).toEqual(['ArnLike', 'StringEquals']);
  });

  test('the malware scan-result and notification rules are still the only other rules', () => {
    const others = Object.entries(resourcesOfType(raw(), 'AWS::Events::Rule'))
      .filter(([, r]) => !JSON.stringify(r.Properties?.EventPattern ?? {}).includes('"GuardDuty Finding"'))
      .map(([id]) => id.replace(/[0-9A-F]{8}$/, ''))
      .sort();
    expect(others).toEqual(['MalwareScanResultRule', 'NotificationRule']);
  });
});
