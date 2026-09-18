import { Match } from 'aws-cdk-lib/assertions';
import { STACK_NAMES, resourcesOfType, synthFanwire } from './helpers';

const synth = () => synthFanwire();
const tpl = () => synth().template(STACK_NAMES.network);
const raw = () => synth().json(STACK_NAMES.network);

describe('Network stack', () => {
  test('is in the primary region / workload account', () => {
    const stack = synth().assembly.getStackByName(STACK_NAMES.network);
    expect(stack.environment.account).toBe('294321867941');
    expect(stack.environment.region).toBe('ca-central-1');
  });

  test('dual-stack VPC: one IPv4 CIDR plus an Amazon-provided IPv6 block', () => {
    tpl().resourceCountIs('AWS::EC2::VPC', 1);
    tpl().hasResourceProperties('AWS::EC2::VPCCidrBlock', { AmazonProvidedIpv6CidrBlock: true });
  });

  test('no NAT Gateway, no NAT instance, no public IPv4 anywhere (aws-stack.md "Explicitly rejected")', () => {
    tpl().resourceCountIs('AWS::EC2::NatGateway', 0);
    tpl().resourceCountIs('AWS::EC2::Instance', 0);
    tpl().resourceCountIs('AWS::EC2::EIP', 0);
    for (const subnet of Object.values(resourcesOfType(raw(), 'AWS::EC2::Subnet'))) {
      expect(subnet.Properties?.MapPublicIpOnLaunch).not.toBe(true);
    }
  });

  test('no IPv4 route to the internet: no 0.0.0.0/0 route at all', () => {
    for (const route of Object.values(resourcesOfType(raw(), 'AWS::EC2::Route'))) {
      expect(route.Properties?.DestinationCidrBlock).toBeUndefined();
    }
  });

  test('egress-only internet gateway carries IPv6 egress for the app subnets only', () => {
    tpl().resourceCountIs('AWS::EC2::EgressOnlyInternetGateway', 1);
    const v6Routes = Object.values(resourcesOfType(raw(), 'AWS::EC2::Route')).filter(
      (r) => r.Properties?.DestinationIpv6CidrBlock === '::/0',
    );
    // two AZs x app subnets; the data subnets (RDS) get no egress route
    expect(v6Routes).toHaveLength(2);
    for (const r of v6Routes) expect(r.Properties?.EgressOnlyInternetGatewayId).toBeDefined();
  });

  test('app and data subnets across two AZs, AZs pinned (no context lookup at synth)', () => {
    tpl().resourceCountIs('AWS::EC2::Subnet', 4);
    const azs = new Set(
      Object.values(resourcesOfType(raw(), 'AWS::EC2::Subnet')).map((s) => s.Properties?.AvailabilityZone),
    );
    expect([...azs].sort()).toEqual(['ca-central-1a', 'ca-central-1b']);
  });

  test('free gateway endpoints for S3 and DynamoDB, and no paid interface endpoints', () => {
    const endpoints = Object.values(resourcesOfType(raw(), 'AWS::EC2::VPCEndpoint'));
    expect(endpoints).toHaveLength(2);
    for (const e of endpoints) expect(e.Properties?.VpcEndpointType).toBe('Gateway');
    const services = endpoints.map((e) => JSON.stringify(e.Properties?.ServiceName)).join(' ');
    expect(services).toContain('.s3');
    expect(services).toContain('.dynamodb');
  });

  test('database SG admits Postgres only from the Lambda SG, nothing from a CIDR', () => {
    const ingress = [
      ...Object.values(resourcesOfType(raw(), 'AWS::EC2::SecurityGroupIngress')).map((r) => r.Properties),
      ...Object.values(resourcesOfType(raw(), 'AWS::EC2::SecurityGroup')).flatMap(
        (r) => (r.Properties?.SecurityGroupIngress as Record<string, unknown>[] | undefined) ?? [],
      ),
    ];
    expect(ingress).toHaveLength(1);
    expect(ingress[0]).toMatchObject({ IpProtocol: 'tcp', FromPort: 5432, ToPort: 5432 });
    expect(ingress[0]?.SourceSecurityGroupId).toBeDefined();
    expect(ingress[0]?.CidrIp).toBeUndefined();
    expect(ingress[0]?.CidrIpv6).toBeUndefined();
  });

  test('Lambda SG egress: HTTPS only (IPv6 internet via EIGW, IPv4 only reaches the gateway endpoints) + Postgres to the DB SG', () => {
    tpl().hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('Lambda'),
      SecurityGroupEgress: Match.arrayWith([
        Match.objectLike({ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIpv6: '::/0' }),
        Match.objectLike({ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0' }),
      ]),
    });
    tpl().hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
      IpProtocol: 'tcp',
      FromPort: 5432,
      ToPort: 5432,
      DestinationSecurityGroupId: Match.anyValue(),
    });
  });

  test('no custom-resource Lambdas (e.g. restrictDefaultSecurityGroup)', () => {
    tpl().resourceCountIs('AWS::Lambda::Function', 0);
    tpl().resourceCountIs('Custom::VpcRestrictDefaultSG', 0);
  });
});
