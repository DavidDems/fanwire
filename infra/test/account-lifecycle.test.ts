/** USERS-009: complete dormant wiring, isolated authority and automatic cleanup. */
import {
  CfnResource,
  DOMAIN_MODES,
  STACK_NAMES,
  resourcesOfType,
  synthFanwire,
} from "./helpers";

const HANDLER = "app.account_deletion_handler.handler";

function functionByCommand(
  raw: { Resources?: Record<string, CfnResource> },
  command: string,
): [string, CfnResource] {
  const found = Object.entries(
    resourcesOfType(raw, "AWS::Lambda::Function"),
  ).find(
    ([, fn]) =>
      JSON.stringify(
        (fn.Properties?.ImageConfig as { Command?: string[] })?.Command,
      ) === JSON.stringify([command]),
  );
  if (!found) throw new Error(`missing function command ${command}`);
  return found;
}

function statements(
  raw: { Resources?: Record<string, CfnResource> },
  role: string,
): Record<string, unknown>[] {
  const inline = (resourcesOfType(raw, "AWS::IAM::Role")[role]?.Properties
    ?.Policies ?? []) as {
    PolicyDocument: { Statement: Record<string, unknown>[] };
  }[];
  const attached = Object.values(resourcesOfType(raw, "AWS::IAM::Policy"))
    .filter((policy) =>
      ((policy.Properties?.Roles ?? []) as { Ref?: string }[]).some(
        (ref) => ref.Ref === role,
      ),
    )
    .flatMap(
      (policy) =>
        (
          policy.Properties?.PolicyDocument as {
            Statement: Record<string, unknown>[];
          }
        ).Statement,
    );
  return [
    ...inline.flatMap((policy) => policy.PolicyDocument.Statement),
    ...attached,
  ];
}

describe.each(Object.entries(DOMAIN_MODES))(
  "account lifecycle (%s)",
  (_mode, overrides) => {
    const synth = () => synthFanwire(overrides);
    const raw = () => synth().json(STACK_NAMES.app);

    test("reconciler shares the image, private network and CMK but has its own role", () => {
      const [, reconciler] = functionByCommand(raw(), HANDLER);
      const [, api] = functionByCommand(raw(), "app.main.handler");
      expect(reconciler.Properties?.PackageType).toBe("Image");
      expect(reconciler.Properties?.Code).toEqual(api.Properties?.Code);
      expect(reconciler.Properties?.VpcConfig).toEqual(
        api.Properties?.VpcConfig,
      );
      expect(reconciler.Properties?.KmsKeyArn).toEqual(
        api.Properties?.KmsKeyArn,
      );
      expect(reconciler.Properties?.Role).not.toEqual(api.Properties?.Role);
      expect(
        reconciler.Properties?.ReservedConcurrentExecutions,
      ).toBeUndefined();
      expect(reconciler.Properties?.Timeout).toEqual(expect.any(Number));
      expect(reconciler.Properties?.Timeout).toBeLessThanOrEqual(240);
    });

    test("five-minute rule invokes only the reconciler with resource-scoped permission", () => {
      const [id] = functionByCommand(raw(), HANDLER);
      const rules = Object.entries(
        resourcesOfType(raw(), "AWS::Events::Rule"),
      ).filter(([, rule]) =>
        JSON.stringify(rule.Properties?.Targets).includes(id),
      );
      expect(rules).toHaveLength(1);
      expect(rules[0][1].Properties?.ScheduleExpression).toBe(
        "rate(5 minutes)",
      );
      expect(rules[0][1].Properties?.Targets).toEqual([
        expect.objectContaining({ Arn: { "Fn::GetAtt": [id, "Arn"] } }),
      ]);
      const permissions = Object.values(
        resourcesOfType(raw(), "AWS::Lambda::Permission"),
      ).filter((permission) =>
        JSON.stringify(permission.Properties?.FunctionName).includes(id),
      );
      expect(permissions).toHaveLength(1);
      expect(permissions[0].Properties).toMatchObject({
        Action: "lambda:InvokeFunction",
        Principal: "events.amazonaws.com",
        SourceArn: { "Fn::GetAtt": [rules[0][0], "Arn"] },
      });
      const [migrationId] = functionByCommand(raw(), "app.migrate.handler");
      expect(JSON.stringify(rules[0][1].Properties?.Targets)).not.toContain(
        migrationId,
      );
    });

    test("API, consumers, migration and reconciler agree on trusted namespace; activation stays dormant", () => {
      const commands = [
        "app.main.handler",
        "app.media.lambda_handler.handler",
        "app.notifications.lambda_handler.handler",
        "app.migrate.handler",
        HANDLER,
      ];
      const env = commands.map((command) => {
        const [, fn] = functionByCommand(raw(), command);
        return (
          fn.Properties?.Environment as { Variables: Record<string, unknown> }
        ).Variables;
      });
      for (const current of env) {
        expect(current.COGNITO_REGION).toBe("ca-central-1");
        expect(current.COGNITO_USER_POOL_ID).toEqual(
          env[0].COGNITO_USER_POOL_ID,
        );
        expect(current.COGNITO_USER_POOL_ID).toBeDefined();
      }
      for (const current of env.filter((_current, index) => index !== 3)) {
        expect(current.ACCOUNT_LIFECYCLE_ENABLED).toBe("false");
      }
    });

    test("reconciler can delete exact pool identity and media objects, not passwords or other pools", () => {
      const [, fn] = functionByCommand(raw(), HANDLER);
      const role = (fn.Properties?.Role as { "Fn::GetAtt": [string, string] })[
        "Fn::GetAtt"
      ][0];
      const policies = statements(raw(), role);
      const identity = policies.filter((statement) =>
        JSON.stringify(statement.Action).includes("cognito-idp:"),
      );
      expect(identity).toHaveLength(1);
      expect(
        Array.isArray(identity[0].Action) ? identity[0].Action : [identity[0].Action],
      ).toEqual(["cognito-idp:AdminDeleteUser"]);
      const [, api] = functionByCommand(raw(), "app.main.handler");
      const apiRole = (
        api.Properties?.Role as { "Fn::GetAtt": [string, string] }
      )["Fn::GetAtt"][0];
      const apiDelete = statements(raw(), apiRole).find((statement) =>
        JSON.stringify(statement.Action).includes(
          "cognito-idp:AdminDeleteUser",
        ),
      );
      expect(identity[0].Resource).toEqual(apiDelete?.Resource);
      const deletion = policies.filter((statement) =>
        JSON.stringify(statement.Action).includes("s3:DeleteObject"),
      );
      expect(deletion.length).toBeGreaterThan(0);
      for (const statement of deletion) {
        const resources = JSON.stringify(statement.Resource);
        expect(resources).toMatch(/Quarantine|Public/i);
      }
      const actions = policies.flatMap((statement) =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action],
      );
      for (const forbidden of [
        "cognito-idp:ListUsers",
        "cognito-idp:AdminSetUserPassword",
        "cognito-idp:AdminUserGlobalSignOut",
        "ses:SendEmail",
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "lambda:InvokeFunction",
        "s3:DeleteObjectVersion",
      ])
        expect(actions).not.toContain(forbidden);
      for (const action of actions) expect(String(action)).not.toContain("*");
    });

    test.each(["Errors", "Throttles"])(
      "reconciler has the existing SNS-connected %s alarm",
      (metric) => {
        const [id] = functionByCommand(raw(), HANDLER);
        const alarms = Object.values(
          resourcesOfType(raw(), "AWS::CloudWatch::Alarm"),
        ).filter(
          (alarm) =>
            alarm.Properties?.Namespace === "AWS/Lambda" &&
            alarm.Properties?.MetricName === metric &&
            JSON.stringify(alarm.Properties?.Dimensions).includes(id),
        );
        expect(alarms).toHaveLength(1);
        expect(alarms[0].Properties?.AlarmActions).toHaveLength(1);
        expect(alarms[0].Properties?.OKActions).toEqual(
          alarms[0].Properties?.AlarmActions,
        );
      },
    );
  },
);
