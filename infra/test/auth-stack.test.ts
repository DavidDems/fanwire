import { Match } from 'aws-cdk-lib/assertions';
import { STACK_NAMES, synthFanwire } from './helpers';

const tpl = () => synthFanwire().template(STACK_NAMES.auth);

describe('Auth stack (Cognito)', () => {
  test('one user pool: email sign-in, self sign-up, email verification', () => {
    tpl().resourceCountIs('AWS::Cognito::UserPool', 1);
    tpl().hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: ['email'],
      AutoVerifiedAttributes: ['email'],
      UserAttributeUpdateSettings: {
        AttributesRequireVerificationBeforeUpdate: ['email'],
      },
      AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: false }),
      AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }] },
      DeletionProtection: 'ACTIVE',
    });
  });

  test('strong password policy', () => {
    tpl().hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: {
        PasswordPolicy: Match.objectLike({
          MinimumLength: 12,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        }),
      },
    });
  });

  test('optional MFA, TOTP only (no SMS)', () => {
    tpl().hasResourceProperties('AWS::Cognito::UserPool', {
      MfaConfiguration: 'OPTIONAL',
      EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
    });
  });

  test('pre-sign-up Lambda auto-confirms without verifying email and is boundary-limited to logs', () => {
    const raw = synthFanwire().json(STACK_NAMES.auth);
    const resources = raw.Resources ?? {};
    const trigger = Object.entries(resources).find(([, resource]) => {
      if (resource.Type !== 'AWS::Lambda::Function') return false;
      const code = resource.Properties?.Code as Record<string, unknown> | undefined;
      return typeof code?.ZipFile === 'string' && code.ZipFile.includes('autoConfirmUser');
    });

    expect(trigger).toBeDefined();
    if (!trigger) throw new Error('the inline pre-sign-up function is missing');
    const [functionId, functionResource] = trigger;
    const functionProperties = functionResource.Properties ?? {};
    const code = (functionProperties.Code as Record<string, unknown>).ZipFile as string;

    expect(functionProperties.Runtime).toBe('python3.12');
    expect(functionProperties.Timeout as number).toBeLessThanOrEqual(5);
    expect(functionProperties.VpcConfig).toBeUndefined();
    expect(code).toMatch(/autoConfirmUser["']\]\s*=\s*True/);
    expect(code).not.toContain('autoVerifyEmail');

    const pool = Object.values(resources).find(
      (resource) => resource.Type === 'AWS::Cognito::UserPool',
    );
    const poolProperties = pool?.Properties ?? {};
    const lambdaConfig = poolProperties.LambdaConfig as Record<string, unknown> | undefined;
    expect(lambdaConfig?.PreSignUp).toBeDefined();
    expect(JSON.stringify(lambdaConfig?.PreSignUp)).toContain(functionId);

    const roleReference = functionProperties.Role as
      | { 'Fn::GetAtt'?: [string, string] }
      | undefined;
    const roleId = roleReference?.['Fn::GetAtt']?.[0];
    expect(roleId).toBeDefined();
    if (!roleId) throw new Error('the pre-sign-up Lambda role reference is missing');
    const role = resources[roleId];
    expect(JSON.stringify(role?.Properties?.PermissionsBoundary)).toContain(
      'FanwireRoleBoundary',
    );

    const statements: Record<string, unknown>[] = [];
    for (const policy of (role?.Properties?.Policies as Record<string, unknown>[] | undefined) ?? []) {
      const document = policy.PolicyDocument as { Statement?: Record<string, unknown>[] } | undefined;
      statements.push(...(document?.Statement ?? []));
    }
    for (const resource of Object.values(resources)) {
      if (resource.Type !== 'AWS::IAM::Policy') continue;
      const attachedRoles = resource.Properties?.Roles as unknown[] | undefined;
      if (!attachedRoles?.some((attached) => JSON.stringify(attached).includes(roleId))) continue;
      const document = resource.Properties?.PolicyDocument as
        | { Statement?: Record<string, unknown>[] }
        | undefined;
      statements.push(...(document?.Statement ?? []));
    }
    const actions = statements.flatMap((statement) => {
      const action = statement.Action;
      return Array.isArray(action) ? action : [action];
    });
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => typeof action === 'string' && action.startsWith('logs:'))).toBe(true);

    const logGroup = Object.entries(resources).find(
      ([logicalId, resource]) =>
        logicalId.includes('PreSignUpLogGroup') && resource.Type === 'AWS::Logs::LogGroup',
    );
    expect(logGroup).toBeDefined();
    if (!logGroup) throw new Error('the dedicated pre-sign-up log group is missing');
    const statementResources = statements.flatMap((statement) => {
      const resource = statement.Resource;
      return Array.isArray(resource) ? resource : [resource];
    });
    expect(statementResources.length).toBeGreaterThan(0);
    expect(statementResources.every((resource) => {
      const serialized = JSON.stringify(resource);
      return serialized.includes(logGroup[0]) &&
        (serialized.match(/\*/g) ?? []).length === 1 &&
        /:log-stream:\*"\]\]\}$/.test(serialized);
    })).toBe(true);

    const managedPolicies = (role?.Properties?.ManagedPolicyArns as unknown[] | undefined) ?? [];
    expect(managedPolicies).toEqual([]);
  });

  test('SPA public client: no secret, SRP + refresh only, no OAuth, no user-existence leaks', () => {
    tpl().resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    tpl().hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
      AllowedOAuthFlowsUserPoolClient: false,
    });
  });

  test('ID token audience = the client id: the backend verifier checks aud against COGNITO_APP_CLIENT_ID', () => {
    // app.users.dependencies builds issuer https://cognito-idp.<region>.amazonaws.com/<pool>
    // and audience=<client id>; only ID tokens carry `aud`, so the SPA must send the ID token.
    tpl().hasResourceProperties('AWS::Cognito::UserPoolClient', {
      IdTokenValidity: 60,
      TokenValidityUnits: Match.objectLike({ IdToken: 'minutes' }),
    });
  });

  test('outputs pool id, client id, region for the frontend (VITE_*) and backend (COGNITO_*)', () => {
    const outputs = synthFanwire().json(STACK_NAMES.auth).Outputs ?? {};
    expect(Object.keys(outputs)).toEqual(expect.arrayContaining(['UserPoolId', 'UserPoolClientId', 'CognitoRegion']));
  });
});
