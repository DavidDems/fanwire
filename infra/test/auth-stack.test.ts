import { Match } from 'aws-cdk-lib/assertions';
import { STACK_NAMES, synthFanwire } from './helpers';

const tpl = () => synthFanwire().template(STACK_NAMES.auth);

describe('Auth stack (Cognito)', () => {
  test('one user pool: email sign-in, self sign-up, email verification', () => {
    tpl().resourceCountIs('AWS::Cognito::UserPool', 1);
    tpl().hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: ['email'],
      AutoVerifiedAttributes: ['email'],
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

  test('optional MFA, TOTP only (no SMS: no SNS spend, no SMS role)', () => {
    tpl().hasResourceProperties('AWS::Cognito::UserPool', {
      MfaConfiguration: 'OPTIONAL',
      EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
    });
    tpl().resourceCountIs('AWS::IAM::Role', 0);
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
