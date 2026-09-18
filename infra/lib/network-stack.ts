import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * VPC for the Lambdas that must reach RDS, with NO NAT Gateway
 * (aws-stack.md "Explicitly rejected at this scale").
 *
 * Egress decision (flagged for human sign-off, see
 * wiki/CodeContext/Modules/0x00-architecture.md "Infra (CDK) —
 * implementation notes"): the VPC is dual-stack. The app subnets route
 * `::/0` to a free egress-only internet gateway, so VPC Lambdas running with
 * `ipv6AllowedForDualStack` reach IPv6-capable public endpoints -- API-SPORTS
 * (Cloudflare, AAAA records), Cognito's JWKS endpoint, Secrets Manager, and
 * the dual-stack (`*.api.aws`) EventBridge / SES endpoints -- without NAT and
 * without paid interface endpoints. There is no IPv4 route to the internet at
 * all; IPv4 only reaches S3 and DynamoDB through their free gateway endpoints.
 * The data subnets (RDS) have no egress route of either family.
 */
export class NetworkStack extends cdk.Stack {
  readonly vpc: ec2.Vpc;
  /** Attached to every VPC Lambda. */
  readonly lambdaSecurityGroup: ec2.SecurityGroup;
  /** Attached to the RDS instance. */
  readonly databaseSecurityGroup: ec2.SecurityGroup;

  static readonly APP_SUBNETS = 'app';
  static readonly DATA_SUBNETS = 'data';

  /**
   * Pinned AZs. With an explicit env, CDK otherwise resolves the stack's AZs
   * through a context lookup, which needs AWS credentials at synth time.
   */
  override get availabilityZones(): string[] {
    return [`${this.region}a`, `${this.region}b`];
  }

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.40.0.0/16'),
      ipProtocol: ec2.IpProtocol.DUAL_STACK,
      availabilityZones: this.availabilityZones,
      natGateways: 0,
      // Nothing here needs an IPv4 internet gateway (no public subnets, no
      // inbound path: CloudFront -> API Gateway is the only entry, per security.md).
      createInternetGateway: false,
      restrictDefaultSecurityGroup: false, // avoids CDK's custom-resource Lambda (wildcard IAM)
      subnetConfiguration: [
        // PRIVATE_WITH_EGRESS + DUAL_STACK + no NAT = only the ::/0 -> EIGW route.
        { name: NetworkStack.APP_SUBNETS, subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: NetworkStack.DATA_SUBNETS, subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      gatewayEndpoints: {
        S3: { service: ec2.GatewayVpcEndpointAwsService.S3, subnets: [{ subnetGroupName: NetworkStack.APP_SUBNETS }] },
        DynamoDB: {
          service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
          subnets: [{ subnetGroupName: NetworkStack.APP_SUBNETS }],
        },
      },
    });

    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: this.vpc,
      description: 'fanwire VPC Lambdas: HTTPS out, Postgres to the DB SG, nothing in',
      allowAllOutbound: false,
      allowAllIpv6Outbound: false,
    });
    // IPv6 HTTPS to the internet via the egress-only IGW: API-SPORTS, Cognito
    // JWKS, Secrets Manager, EventBridge/SES dual-stack endpoints.
    this.lambdaSecurityGroup.addEgressRule(ec2.Peer.anyIpv6(), ec2.Port.tcp(443), 'HTTPS over IPv6 via egress-only IGW');
    // IPv4 HTTPS. The subnets have no IPv4 internet route, so in practice this
    // only reaches the S3/DynamoDB gateway endpoints. (Scoping it to their
    // AWS-managed prefix lists would need a synth-time lookup with credentials.)
    this.lambdaSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS over IPv4: only S3/DynamoDB gateway endpoints are routable',
    );

    this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSg', {
      vpc: this.vpc,
      description: 'fanwire RDS Postgres: inbound 5432 from the Lambda SG only',
      allowAllOutbound: false,
      allowAllIpv6Outbound: false,
    });
    this.databaseSecurityGroup.addIngressRule(this.lambdaSecurityGroup, ec2.Port.tcp(5432), 'Postgres from VPC Lambdas');
    this.lambdaSecurityGroup.addEgressRule(this.databaseSecurityGroup, ec2.Port.tcp(5432), 'Postgres to RDS');
  }
}
