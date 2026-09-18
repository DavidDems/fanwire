import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/**
 * Cognito owns credentials, MFA, token issuance, password reset and email
 * confirmation (0x00-architecture.md "Auth"). Its own stack: no dependency
 * on anything else, and nothing about it should churn with app deploys.
 *
 * Must line up with the backend verifier (app.users.dependencies /
 * app.users.auth): issuer `https://cognito-idp.<COGNITO_REGION>.amazonaws.com/<pool id>`,
 * audience = COGNITO_APP_CLIENT_ID, RS256. Only ID tokens carry `aud`, so
 * the SPA sends the ID token as the bearer token.
 */
export class AuthStack extends cdk.Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      // Lite covers everything used here (email sign-in, verification, TOTP MFA)
      // at the lowest per-MAU price.
      featurePlan: cognito.FeaturePlan.LITE,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      keepOriginal: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // Default Cognito email sender (low daily quota). Switch to SES once the
      // domain exists and an SES identity is verified.
      email: cognito.UserPoolEmail.withCognito(),
    });

    this.userPoolClient = this.userPool.addClient('SpaClient', {
      userPoolClientName: 'fanwire-spa',
      // Public client: amazon-cognito-identity-js runs in the browser and can't keep a secret.
      generateSecret: false,
      authFlows: { userSrp: true },
      disableOAuth: true,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      idTokenValidity: cdk.Duration.hours(1),
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'VITE_COGNITO_USER_POOL_ID / COGNITO_USER_POOL_ID',
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'VITE_COGNITO_CLIENT_ID / COGNITO_APP_CLIENT_ID',
    });
    new cdk.CfnOutput(this, 'CognitoRegion', {
      value: this.region,
      description: 'VITE_COGNITO_REGION / COGNITO_REGION',
    });
  }
}
