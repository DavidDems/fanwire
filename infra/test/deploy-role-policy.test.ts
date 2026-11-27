/**
 * The deploy role's permissions policy (infra/iam/, applied by the human)
 * is not a CDK resource, so the wildcard gate in iam-policy.test.ts never sees
 * it. This is its gate: no wildcard in any Action or Resource, and the one
 * lambda:InvokeFunction grant (ADR 0044) names exactly the Migration function
 * the stack creates.
 */
import * as fs from 'fs';
import * as path from 'path';
import { STACK_NAMES, resourcesOfType, synthFanwire } from './helpers';

interface Statement {
  Sid: string;
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
}
const policy = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'iam', 'github-actions-deploy-role-policy.json'), 'utf8'),
) as { Statement: Statement[] };
const list = (v: string | string[]) => (Array.isArray(v) ? v : [v]);

describe('GitHubActionsDeployRole policy', () => {
  test('no wildcard in any Action or Resource', () => {
    for (const s of policy.Statement) {
      for (const v of [...list(s.Action), ...list(s.Resource)]) expect(v).not.toContain('*');
    }
  });

  test('grants lambda:InvokeFunction on the Migration function and nothing else', () => {
    const invoke = policy.Statement.filter((s) => list(s.Action).includes('lambda:InvokeFunction'));
    expect(invoke).toHaveLength(1);
    expect(invoke[0]?.Effect).toBe('Allow');
    expect(list(invoke[0]!.Action)).toEqual(['lambda:InvokeFunction']);
    expect(list(invoke[0]!.Resource)).toEqual(['arn:aws:lambda:ca-central-1:294321867941:function:fanwire-migration']);
  });

  test('that ARN names the function the app stack creates', () => {
    const names = Object.values(resourcesOfType(synthFanwire().json(STACK_NAMES.app), 'AWS::Lambda::Function')).map(
      (f) => f.Properties?.FunctionName,
    );
    expect(names).toContain('fanwire-migration');
  });
});
