import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * VPC for the Lambdas that must reach RDS.
 *
 * Egress (human decision 2026-09-18, wiki/CodeContext/Standards/aws-stack.md
 * "Explicitly rejected"): a NAT Gateway stays rejected; a single small NAT
 * *instance* (t4g.nano) gives the in-VPC Lambdas their path to the public
 * internet -- API-SPORTS for ingestion, Cognito's JWKS for the API -- and to
 * the AWS APIs that have no gateway endpoint (EventBridge, Secrets Manager,
 * SES, Cognito). S3 and DynamoDB go through their free gateway endpoints.
 * No interface endpoints: see 0x00-architecture.md "Infra (CDK) —
 * implementation notes" for the cost table.
 *
 * Subnets: `public` (IGW; holds only the NAT instance), `app` (Lambdas;
 * 0.0.0.0/0 -> NAT instance), `data` (RDS; no route out at all).
 */
export class NetworkStack extends cdk.Stack {
  readonly vpc: ec2.Vpc;
  /** Attached to every VPC Lambda. */
  readonly lambdaSecurityGroup: ec2.SecurityGroup;
  /** Attached to the RDS instance. */
  readonly databaseSecurityGroup: ec2.SecurityGroup;
  readonly natSecurityGroup: ec2.SecurityGroup;

  static readonly PUBLIC_SUBNETS = 'public';
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

    // instanceV2 (not the deprecated v1 provider): configures iptables
    // masquerading in user data and disables source/dest check.
    const natProvider = ec2.NatProvider.instanceV2({
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      // Ingress is added explicitly below (HTTPS from the Lambda SG only).
      defaultAllowedTraffic: ec2.NatTrafficDirection.NONE,
      associatePublicIpAddress: true,
    });

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.40.0.0/16'),
      availabilityZones: this.availabilityZones,
      natGatewayProvider: natProvider,
      natGateways: 1, // one NAT instance, shared by both AZs' app subnets
      natGatewaySubnets: { subnetGroupName: NetworkStack.PUBLIC_SUBNETS },
      restrictDefaultSecurityGroup: false, // avoids CDK's custom-resource Lambda (wildcard IAM)
      subnetConfiguration: [
        { name: NetworkStack.PUBLIC_SUBNETS, subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
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
    });
    // Internet (API-SPORTS, Cognito JWKS) and AWS APIs via the NAT instance;
    // S3/DynamoDB via gateway endpoints.
    this.lambdaSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS via NAT instance / gateway endpoints');

    this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSg', {
      vpc: this.vpc,
      description: 'fanwire RDS Postgres: inbound 5432 from the Lambda SG only',
      allowAllOutbound: false,
    });
    this.databaseSecurityGroup.addIngressRule(this.lambdaSecurityGroup, ec2.Port.tcp(5432), 'Postgres from VPC Lambdas');
    this.lambdaSecurityGroup.addEgressRule(this.databaseSecurityGroup, ec2.Port.tcp(5432), 'Postgres to RDS');

    // --- NAT instance hardening.
    this.natSecurityGroup = natProvider.securityGroup as ec2.SecurityGroup;
    this.natSecurityGroup.addIngressRule(this.lambdaSecurityGroup, ec2.Port.tcp(443), 'HTTPS from VPC Lambdas only');
    this.natSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS out: forwarded Lambda traffic, SSM agent, package repos',
    );

    const [natInstance] = natProvider.gatewayInstances;
    if (!natInstance) throw new Error('NAT instance provider created no instance');
    // No SSH: no key pair, no port 22. Admin via SSM Session Manager only
    // (security.md "Network"). These five actions are AWS's documented
    // minimum for the Session Manager agent; ssmmessages:* have no
    // resource-level permissions.
    natInstance.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SessionManagerAgent',
        actions: [
          'ssm:UpdateInstanceInformation',
          'ssmmessages:CreateControlChannel',
          'ssmmessages:CreateDataChannel',
          'ssmmessages:OpenControlChannel',
          'ssmmessages:OpenDataChannel',
        ],
        resources: ['*'],
      }),
    );
    cdk.Aspects.of(this).add(new ec2.InstanceRequireImdsv2Aspect());
  }
}
