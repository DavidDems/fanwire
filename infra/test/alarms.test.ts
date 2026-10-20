/**
 * INFRA-004: make breakage visible. One SNS alarm topic in Fanwire-Messaging,
 * CloudWatch alarms beside what they watch (DLQs in Messaging; the HTTP API,
 * every Lambda function and the RDS instance in App), and every alarm sending
 * both ALARM and OK to that topic.
 *
 * Alarms are found by what they watch (namespace, metric, dimensions), never by
 * generated logical id, and the DLQ and function lists are derived from the
 * templates, so a new queue or function without alarms fails here.
 */
import { Match, Template } from 'aws-cdk-lib/assertions';
import {
  CfnResource,
  DOMAIN_MODES,
  DOMAIN_MODES_DEPLOYING,
  STACK_NAMES,
  cleanupFrontendDist,
  ensureFrontendDist,
  resourcesOfType,
  synthFanwire,
} from './helpers';

const FIVE_MINUTES = 300;
const TWO_GIB = 2147483648;

/** Every mode `cdk synth` supports, with and without the frontend deployment. */
const SYNTH_MODES: Record<string, Record<string, unknown>> = {
  ...DOMAIN_MODES,
  ...Object.fromEntries(
    Object.entries(DOMAIN_MODES_DEPLOYING).map(([mode, overrides]) => [`${mode}, deployFrontend`, overrides]),
  ),
};

/**
 * The pinned alarm count, the same in every synth mode. Changing it is a
 * deliberate change to this line:
 *   3 DLQ (notification, ingestion-retry, media-scan-result)
 * + 3 HTTP API ($default 5xx, Latency p95, Latency p99)
 * + 2 x 6 Lambda functions in Fanwire-App (Errors + Throttles each: Api, Media,
 *   Notifications, Migration, SportsDataLoad, OriginVerifyAuthorizer)
 * + 3 RDS (CPUUtilization, FreeStorageSpace, DatabaseConnections)
 * = 21
 */
const EXPECTED_ALARM_COUNT = 3 + 3 + 2 * 6 + 3;

beforeAll(() => {
  ensureFrontendDist();
});
afterAll(() => {
  cleanupFrontendDist();
});

const synth = () => synthFanwire();
const messagingRaw = () => synth().json(STACK_NAMES.messaging);
const appRaw = () => synth().json(STACK_NAMES.app);

type Props = Record<string, unknown>;
interface Dimension {
  Name: string;
  Value: unknown;
}

const alarmsIn = (tpl: { Resources?: Record<string, CfnResource> }): Props[] =>
  Object.values(resourcesOfType(tpl, 'AWS::CloudWatch::Alarm')).map((a) => (a.Properties ?? {}) as Props);

const dimensionsOf = (alarm: Props): Dimension[] => (alarm.Dimensions as Dimension[] | undefined) ?? [];

const dimensionValue = (alarm: Props, name: string): unknown => dimensionsOf(alarm).find((d) => d.Name === name)?.Value;

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The alarms in `tpl` on `namespace`/`metric` whose dimension `dimName` equals `dimValue`. */
function alarmsOn(
  tpl: { Resources?: Record<string, CfnResource> },
  namespace: string,
  metric: string,
  dimName: string,
  dimValue: unknown,
): Props[] {
  return alarmsIn(tpl).filter(
    (a) => a.Namespace === namespace && a.MetricName === metric && sameJson(dimensionValue(a, dimName), dimValue),
  );
}

/** Exactly one alarm matches, and it is returned. */
function onlyAlarmOn(
  tpl: { Resources?: Record<string, CfnResource> },
  namespace: string,
  metric: string,
  dimName: string,
  dimValue: unknown,
): Props {
  const hits = alarmsOn(tpl, namespace, metric, dimName, dimValue);
  expect({ metric: `${namespace} ${metric} ${dimName}=${JSON.stringify(dimValue)}`, count: hits.length }).toEqual({
    metric: `${namespace} ${metric} ${dimName}=${JSON.stringify(dimValue)}`,
    count: 1,
  });
  return hits[0];
}

/** The alarm topic's logical id in Fanwire-Messaging (there must be exactly one topic). */
function topicId(): string {
  const topics = Object.keys(resourcesOfType(messagingRaw(), 'AWS::SNS::Topic'));
  expect(topics).toHaveLength(1);
  return topics[0];
}

/** The export name under which Fanwire-Messaging exports the topic's ARN (a Ref to the topic). */
function topicExportName(): string {
  const id = topicId();
  const outputs = (messagingRaw().Outputs ?? {}) as Record<string, { Value?: unknown; Export?: { Name?: unknown } }>;
  const out = Object.values(outputs).find((o) => sameJson(o.Value, { Ref: id }) && o.Export?.Name !== undefined);
  if (!out) throw new Error(`Fanwire-Messaging does not export the ARN of topic ${id}`);
  return out.Export?.Name as string;
}

/** How Fanwire-App names the alarm topic: an import of Messaging's export. */
const importedTopicArn = () => ({ 'Fn::ImportValue': topicExportName() });

/** Queues named as a deadLetterTargetArn in another queue's RedrivePolicy. */
function deadLetterQueueIds(): string[] {
  const ids = new Set<string>();
  for (const q of Object.values(resourcesOfType(messagingRaw(), 'AWS::SQS::Queue'))) {
    const target = (q.Properties?.RedrivePolicy as { deadLetterTargetArn?: { 'Fn::GetAtt'?: [string, string] } })
      ?.deadLetterTargetArn?.['Fn::GetAtt'];
    if (target) ids.add(target[0]);
  }
  return [...ids].sort();
}

const appFunctionIds = () => Object.keys(resourcesOfType(appRaw(), 'AWS::Lambda::Function')).sort();

function httpApiId(): string {
  const apis = Object.keys(resourcesOfType(appRaw(), 'AWS::ApiGatewayV2::Api'));
  expect(apis).toHaveLength(1);
  return apis[0];
}

/** The $default stage, as an alarm's Stage dimension may name it. */
function defaultStageMatches(value: unknown): boolean {
  if (value === '$default') return true;
  const stages = Object.entries(resourcesOfType(appRaw(), 'AWS::ApiGatewayV2::Stage')).filter(
    ([, s]) => s.Properties?.StageName === '$default',
  );
  return stages.some(([id]) => sameJson(value, { Ref: id }));
}

/** Alarms on the HTTP API's $default stage for `metric`. */
function stageAlarms(metric: string): Props[] {
  return alarmsIn(appRaw()).filter(
    (a) =>
      a.Namespace === 'AWS/ApiGateway' &&
      a.MetricName === metric &&
      sameJson(dimensionValue(a, 'ApiId'), { Ref: httpApiId() }) &&
      defaultStageMatches(dimensionValue(a, 'Stage')),
  );
}

describe('alarm topic (Fanwire-Messaging)', () => {
  test('exactly one SNS topic, in Fanwire-Messaging', () => {
    Template.fromJSON(messagingRaw()).resourceCountIs('AWS::SNS::Topic', 1);
  });

  test('no stack, in any synth mode, subscribes an address (it is set by hand, never committed)', () => {
    for (const [mode, overrides] of Object.entries(SYNTH_MODES)) {
      const s = synthFanwire(overrides);
      for (const stack of s.stackNames()) {
        const subs = Object.keys(resourcesOfType(s.json(stack), 'AWS::SNS::Subscription'));
        expect({ mode, stack, subs }).toEqual({ mode, stack, subs: [] });
      }
    }
  });

  test('topic policy denies publishing without TLS (enforceSSL)', () => {
    const id = topicId();
    Template.fromJSON(messagingRaw()).hasResourceProperties('AWS::SNS::TopicPolicy', {
      Topics: Match.arrayWith([{ Ref: id }]),
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: Match.anyValue(),
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            Resource: { Ref: id },
          }),
        ]),
      },
    });
    const policies = Object.values(resourcesOfType(messagingRaw(), 'AWS::SNS::TopicPolicy'));
    const denied = policies
      .flatMap((p) => (p.Properties?.PolicyDocument as { Statement: Props[] }).Statement)
      .filter((st) => st.Effect === 'Deny')
      .flatMap((st) => (Array.isArray(st.Action) ? st.Action : [st.Action]));
    expect(denied).toContain('sns:Publish');
  });

  test('Messaging exports the topic ARN, and Fanwire-App imports it', () => {
    const name = topicExportName();
    expect(JSON.stringify(appRaw())).toContain(JSON.stringify({ 'Fn::ImportValue': name }));
  });

  test('Fanwire-App outputs AlarmTopicArn, the imported topic ARN', () => {
    const outputs = (appRaw().Outputs ?? {}) as Record<string, { Value?: unknown }>;
    expect(Object.keys(outputs)).toContain('AlarmTopicArn');
    expect(outputs.AlarmTopicArn?.Value).toEqual(importedTopicArn());
  });
});

describe('dead-letter queue alarms (Fanwire-Messaging)', () => {
  test('the three DLQs are derived from the redrive policies', () => {
    expect(deadLetterQueueIds()).toHaveLength(3);
  });

  test('every DLQ alarms on ApproximateNumberOfMessagesVisible: Maximum > 0 over one 5-minute period', () => {
    for (const dlq of deadLetterQueueIds()) {
      const alarm = onlyAlarmOn(messagingRaw(), 'AWS/SQS', 'ApproximateNumberOfMessagesVisible', 'QueueName', {
        'Fn::GetAtt': [dlq, 'QueueName'],
      });
      expect(alarm).toMatchObject({
        Statistic: 'Maximum',
        Period: FIVE_MINUTES,
        ComparisonOperator: 'GreaterThanThreshold',
        Threshold: 0,
        EvaluationPeriods: 1,
      });
    }
  });
});

describe('HTTP API alarms (Fanwire-App, $default stage)', () => {
  test('5xx: Sum >= 5 over 5 minutes', () => {
    const hits = stageAlarms('5xx');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      Statistic: 'Sum',
      Period: FIVE_MINUTES,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      Threshold: 5,
    });
    expect(dimensionsOf(hits[0]).map((d) => d.Name).sort()).toEqual(['ApiId', 'Stage']);
  });

  test.each([
    ['p95', 3000],
    ['p99', 8000],
  ])('Latency %s > %d ms for 3 of 3 5-minute periods', (stat, threshold) => {
    const hits = stageAlarms('Latency').filter((a) => a.ExtendedStatistic === stat);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      Period: FIVE_MINUTES,
      EvaluationPeriods: 3,
      DatapointsToAlarm: 3,
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: threshold,
    });
    expect(dimensionsOf(hits[0]).map((d) => d.Name).sort()).toEqual(['ApiId', 'Stage']);
  });
});

describe('Lambda alarms (Fanwire-App)', () => {
  test('the function list is derived from the template and is not empty', () => {
    expect(appFunctionIds().length).toBeGreaterThan(0);
  });

  test.each(['Errors', 'Throttles'])('every function has a %s alarm: Sum >= 1 over 5 minutes', (metric) => {
    const missing: string[] = [];
    for (const id of appFunctionIds()) {
      const hits = alarmsOn(appRaw(), 'AWS/Lambda', metric, 'FunctionName', { Ref: id });
      if (hits.length !== 1) {
        missing.push(`${id} (${hits.length} alarms)`);
        continue;
      }
      expect(hits[0]).toMatchObject({
        Statistic: 'Sum',
        Period: FIVE_MINUTES,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        Threshold: 1,
      });
    }
    expect(missing).toEqual([]);
  });
});

describe('RDS alarms (Fanwire-App)', () => {
  /** The instance is in Fanwire-Data; App names it by an import of Data's export. */
  function rdsAlarm(metric: string): Props {
    const hits = alarmsIn(appRaw()).filter(
      (a) =>
        a.Namespace === 'AWS/RDS' &&
        a.MetricName === metric &&
        /Postgres/.test(JSON.stringify(dimensionValue(a, 'DBInstanceIdentifier') ?? '')),
    );
    expect({ metric, count: hits.length }).toEqual({ metric, count: 1 });
    expect(dimensionValue(hits[0], 'DBInstanceIdentifier')).toEqual({
      'Fn::ImportValue': expect.stringMatching(/^Fanwire-Data:/),
    });
    return hits[0];
  }

  test('CPUUtilization: Average > 80 for 3 of 3 5-minute periods', () => {
    expect(rdsAlarm('CPUUtilization')).toMatchObject({
      Statistic: 'Average',
      Period: FIVE_MINUTES,
      EvaluationPeriods: 3,
      DatapointsToAlarm: 3,
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 80,
    });
  });

  test('FreeStorageSpace: Minimum < 2 GiB', () => {
    expect(rdsAlarm('FreeStorageSpace')).toMatchObject({
      Statistic: 'Minimum',
      Period: FIVE_MINUTES,
      ComparisonOperator: 'LessThanThreshold',
      Threshold: TWO_GIB,
    });
  });

  test('DatabaseConnections: Maximum > 60', () => {
    expect(rdsAlarm('DatabaseConnections')).toMatchObject({
      Statistic: 'Maximum',
      Period: FIVE_MINUTES,
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 60,
    });
  });
});

describe('every alarm notifies the topic', () => {
  test.each([
    [STACK_NAMES.messaging, () => ({ Ref: topicId() })],
    [STACK_NAMES.app, importedTopicArn],
  ])('%s: ALARM and OK both go to the alarm topic; missing data is notBreaching', (stack, topicArn) => {
    const alarms = alarmsIn(synth().json(stack));
    expect(alarms.length).toBeGreaterThan(0);
    for (const a of alarms) {
      expect({ metric: a.MetricName, AlarmActions: a.AlarmActions, OKActions: a.OKActions, TreatMissingData: a.TreatMissingData }).toEqual({
        metric: a.MetricName,
        AlarmActions: [topicArn()],
        OKActions: [topicArn()],
        TreatMissingData: 'notBreaching',
      });
    }
  });

  test('no other stack holds an alarm (each would need its own route to the topic)', () => {
    const elsewhere = synth()
      .stackNames()
      .filter((s) => s !== STACK_NAMES.messaging && s !== STACK_NAMES.app)
      .filter((s) => alarmsIn(synth().json(s)).length > 0);
    expect(elsewhere).toEqual([]);
  });
});

describe('alarm count', () => {
  test.each(Object.entries(SYNTH_MODES))('%s: exactly the pinned number of alarms across all stacks', (_mode, overrides) => {
    const s = synthFanwire(overrides);
    const total = s.stackNames().reduce((n, stack) => n + alarmsIn(s.json(stack)).length, 0);
    expect(total).toBe(EXPECTED_ALARM_COUNT);
  });
});
