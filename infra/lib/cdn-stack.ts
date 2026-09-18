import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { ORIGIN_VERIFY_HEADER } from './app-stack';
import { FanwireConfig } from './config';
import { EdgeStack } from './edge-stack';

export interface CdnStackProps extends cdk.StackProps {
  readonly config: FanwireConfig;
  readonly edge: EdgeStack;
  readonly httpApi: apigwv2.IHttpApi;
  readonly frontendBucket: s3.IBucket;
  readonly publicMediaBucket: s3.IBucket;
  readonly originVerifySecret: secretsmanager.ISecret;
}

/**
 * Viewer-request function on /api/*: the SPA calls `/api/<route>` (its
 * VITE_API_BASE_URL is `/api`) but FastAPI's routes have no prefix
 * (`/users`, `/posts`, `/health`, ...). A CloudFront origin path can only
 * prepend, and an API Gateway base-path mapping needs a custom domain on
 * the API, so the prefix is stripped here -- CloudFront Functions cost
 * $0.10 per million, run at the edge, and need no IAM role (unlike
 * Lambda@Edge).
 */
const STRIP_API_PREFIX = `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === '/api' || uri.indexOf('/api/') === 0) {
    request.uri = uri.substring(4) || '/';
  }
  return request;
}`;

/**
 * Viewer-request function on the default (frontend) behaviour: client-side
 * routes (last path segment has no file extension) get the SPA shell. Done
 * per-behaviour rather than with distribution-wide custom error responses,
 * which would also rewrite the API's own 403/404 JSON into index.html.
 */
const SPA_FALLBACK = `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var last = uri.substring(uri.lastIndexOf('/') + 1);
  if (last.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}`;

/**
 * CloudFront: the only public entry point (security.md "Network").
 *   default  -> frontend bucket (OAC), SPA fallback at the edge
 *   /api/*   -> HTTP API (prefix stripped, uncached, origin-verify header)
 *   /media/* -> public-media bucket (OAC)
 * Also owns the frontend and public-media bucket policies, which must name
 * this distribution (see StorageStack for why they can't live there).
 */
export class CdnStack extends cdk.Stack {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: CdnStackProps) {
    super(scope, id, props);
    const { config, edge } = props;

    // Imported handles: with the real Bucket objects, the OAC origin helper
    // would write this distribution's ARN into a policy in the storage stack
    // (a dependency cycle). This stack owns those policies explicitly below.
    const frontendBucket = s3.Bucket.fromBucketAttributes(this, 'FrontendBucket', {
      bucketArn: props.frontendBucket.bucketArn,
      bucketRegionalDomainName: props.frontendBucket.bucketRegionalDomainName,
    });
    const publicMediaBucket = s3.Bucket.fromBucketAttributes(this, 'PublicMediaBucket', {
      bucketArn: props.publicMediaBucket.bucketArn,
      bucketRegionalDomainName: props.publicMediaBucket.bucketRegionalDomainName,
    });

    const oac = new cloudfront.S3OriginAccessControl(this, 'S3Oac', {
      description: 'fanwire: CloudFront reads the frontend and public-media buckets',
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });
    const s3Origin = (bucket: s3.IBucket) =>
      origins.S3BucketOrigin.withOriginAccessControl(bucket, {
        originAccessControl: oac,
        originAccessLevels: [cloudfront.AccessLevel.READ],
      });

    const apiOrigin = new origins.HttpOrigin(
      `${props.httpApi.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
      {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
        // CloudFormation dynamic reference: resolved at deploy time, so the
        // value is in neither git nor the synthesized template. CloudFront
        // overwrites any viewer-supplied header of the same name.
        customHeaders: { [ORIGIN_VERIFY_HEADER]: props.originVerifySecret.secretValue.unsafeUnwrap() },
      },
    );

    const stripApiPrefix = new cloudfront.Function(this, 'StripApiPrefix', {
      comment: 'Strip the /api prefix before the HTTP API origin',
      code: cloudfront.FunctionCode.fromInline(STRIP_API_PREFIX),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });
    const spaFallback = new cloudfront.Function(this, 'SpaFallback', {
      comment: 'Serve index.html for client-side routes',
      code: cloudfront.FunctionCode.fromInline(SPA_FALLBACK),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const securityHeaders = cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS;
    const certificate = edge.certificate;

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'fanwire',
      webAclId: edge.webAcl.attrArn,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultRootObject: 'index.html',
      ...(certificate && config.domainName
        ? {
            domainNames: [config.domainName],
            certificate,
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            sslSupportMethod: cloudfront.SSLMethod.SNI,
          }
        : {}),
      defaultBehavior: {
        origin: s3Origin(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
        functionAssociations: [{ function: spaFallback, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          // Never cache: responses depend on the caller's token.
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // All viewer headers except Host (API Gateway needs its own Host):
          // this is how Authorization and query strings reach the origin.
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeaders,
          functionAssociations: [{ function: stripApiPrefix, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        },
        '/media/*': {
          origin: s3Origin(publicMediaBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: securityHeaders,
          compress: true,
        },
      },
    });

    const distributionArn = `arn:aws:cloudfront::${this.account}:distribution/${this.distribution.distributionId}`;
    this.oacBucketPolicy('FrontendBucketPolicy', props.frontendBucket, distributionArn);
    this.oacBucketPolicy('PublicMediaBucketPolicy', props.publicMediaBucket, distributionArn);

    if (config.domainName && config.hostedZoneId) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
        hostedZoneId: config.hostedZoneId,
        zoneName: config.hostedZoneName ?? config.domainName,
      });
      const target = route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(this.distribution));
      const recordName = `${config.domainName}.`;
      new route53.ARecord(this, 'AliasA', { zone, recordName, target });
      new route53.AaaaRecord(this, 'AliasAaaa', { zone, recordName, target });
    }

    // Warnings about imported buckets are expected: this stack writes
    // their policies itself (oacBucketPolicy).
    cdk.Annotations.of(this).acknowledgeWarning(
      '@aws-cdk/aws-cloudfront-origins:updateImportedBucketPolicyOac',
      'Bucket policies for the OAC origins are defined explicitly in this stack',
    );

    new cdk.CfnOutput(this, 'DistributionDomainName', { value: this.distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'For cache invalidation after an SPA deploy',
    });
    new cdk.CfnOutput(this, 'SiteUrl', {
      value: `https://${config.domainName ?? this.distribution.distributionDomainName}`,
    });
    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: '/api',
      description: 'VITE_API_BASE_URL (same-origin; CloudFront strips /api before the HTTP API)',
    });
  }

  private oacBucketPolicy(id: string, bucket: s3.IBucket, distributionArn: string): void {
    const document = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: 'DenyInsecureTransport',
          effect: iam.Effect.DENY,
          principals: [new iam.AnyPrincipal()],
          actions: ['s3:*'],
          resources: [bucket.bucketArn, bucket.arnForObjects('*')],
          conditions: { Bool: { 'aws:SecureTransport': 'false' } },
        }),
        new iam.PolicyStatement({
          sid: 'AllowThisDistributionViaOac',
          principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
          actions: ['s3:GetObject'],
          resources: [bucket.arnForObjects('*')],
          conditions: { StringEquals: { 'AWS:SourceArn': distributionArn } },
        }),
      ],
    });
    new s3.CfnBucketPolicy(this, id, { bucket: bucket.bucketName, policyDocument: document });
  }
}
