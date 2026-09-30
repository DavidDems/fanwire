import * as crypto from 'crypto';
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
/**
 * NAT instance bootstrap, replacing CDK's `NatInstanceProviderV2` default.
 * The default failed on the first deploy (2026-09-30): `yum install
 * iptables-services` was OOM-killed on the 512 MB t4g.nano, so no MASQUERADE
 * rule existed and the instance forwarded nothing. It also finds the egress
 * interface with `route`, which AL2023 does not ship.
 *
 * `set -euxo pipefail` makes a failure stop the script, and `-x` echoes every
 * command to the console log (`aws ec2 get-console-output`) -- the only place
 * a bootstrap failure is visible, since the instance has no SSH.
 */
const NAT_BOOTSTRAP = [
  'set -euxo pipefail',
  // dnf's metadata load alone exceeds 512 MB of RAM.
  // Runs once per instance (see the logical-id override below), so no guards.
  'dd if=/dev/zero of=/swapfile bs=1M count=1024',
  'chmod 600 /swapfile',
  'mkswap /swapfile',
  'swapon /swapfile',
  'echo "/swapfile none swap defaults 0 0" >> /etc/fstab',
  'dnf install -y iptables-services',
  'systemctl enable --now iptables',
  'echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/custom-ip-forwarding.conf',
  'sysctl -p /etc/sysctl.d/custom-ip-forwarding.conf',
  "iface=$(ip route show default | awk '{print $5; exit}')",
  '[ -n "$iface" ]',
  'iptables -t nat -A POSTROUTING -o "$iface" -j MASQUERADE',
  // iptables-services' stock FORWARD chain rejects everything.
  'iptables -F FORWARD',
  // Persists the rule for iptables.service. Not `service iptables save`: AL2023
  // has no /usr/sbin/service; the init script ships with iptables-services.
  '/usr/libexec/iptables/iptables.init save',
];

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
    const natUserData = ec2.UserData.forLinux();
    natUserData.addCommands(...NAT_BOOTSTRAP);
    const natProvider = ec2.NatProvider.instanceV2({
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      // Ingress is added explicitly below (HTTPS from the Lambda SG only).
      defaultAllowedTraffic: ec2.NatTrafficDirection.NONE,
      associatePublicIpAddress: true,
      userData: natUserData,
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
    // cloud-init runs user data only on an instance's first boot, and a
    // UserData change is otherwise an in-place stop/start -- the new script
    // would never run. Keying the logical id on the script (what
    // `Instance.userDataCausesReplacement` does, which the NAT provider does
    // not expose) makes any change a replacement; the routes follow by Ref.
    const cfnNat = natInstance.instance;
    cfnNat.overrideLogicalId(
      `${this.getLogicalId(cfnNat)}${crypto.createHash('sha256').update(natUserData.render()).digest('hex').slice(0, 16)}`,
    );
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
