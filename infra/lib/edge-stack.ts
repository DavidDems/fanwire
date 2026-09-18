import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { FanwireConfig } from './config';

export interface EdgeStackProps extends cdk.StackProps {
  readonly config: FanwireConfig;
}

/**
 * CloudFront-scoped pieces, which AWS only accepts from us-east-1: the WAF
 * WebACL (security.md "Edge / application protection") and the ACM
 * certificate. Consumed by the CDN stack via crossRegionReferences.
 */
export class EdgeStack extends cdk.Stack {
  readonly webAcl: wafv2.CfnWebACL;
  /** Undefined when no domainName is configured (distribution uses *.cloudfront.net). */
  readonly certificate?: acm.Certificate;

  /** Requests per IP per 5-minute window before WAF blocks that IP. */
  static readonly RATE_LIMIT_PER_5_MIN = 1000;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const { config } = props;

    const managed = (priority: number, name: string): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: { managedRuleGroupStatement: { vendorName: 'AWS', name } },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: name, sampledRequestsEnabled: true },
    });

    this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'fanwire-web-acl', sampledRequestsEnabled: true },
      rules: [
        {
          // First, so a flood is cut off before the (costlier) rule groups evaluate it.
          name: 'RateLimitPerIp',
          priority: 0,
          action: { block: {} },
          statement: { rateBasedStatement: { aggregateKeyType: 'IP', limit: EdgeStack.RATE_LIMIT_PER_5_MIN } },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'RateLimitPerIp', sampledRequestsEnabled: true },
        },
        managed(1, 'AWSManagedRulesCommonRuleSet'),
        managed(2, 'AWSManagedRulesKnownBadInputsRuleSet'),
        managed(3, 'AWSManagedRulesSQLiRuleSet'),
      ],
    });

    if (config.domainName) {
      // Never HostedZone.fromLookup: that needs credentials at synth time.
      const zone = config.hostedZoneId
        ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
            hostedZoneId: config.hostedZoneId,
            zoneName: config.hostedZoneName ?? config.domainName,
          })
        : undefined;
      this.certificate = new acm.Certificate(this, 'SiteCertificate', {
        domainName: config.domainName,
        // Without a zone, CloudFormation waits on this certificate until a
        // human adds the validation CNAME shown in the ACM console.
        validation: acm.CertificateValidation.fromDns(zone),
      });
    }

    new cdk.CfnOutput(this, 'WebAclArn', { value: this.webAcl.attrArn });
  }
}
