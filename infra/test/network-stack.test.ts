import * as crypto from 'crypto';
import { Match } from 'aws-cdk-lib/assertions';
import { STACK_NAMES, cdkJsonContext, resourcesOfType, synthFanwire, CfnResource } from './helpers';

const synth = () => synthFanwire();
const tpl = () => synth().template(STACK_NAMES.network);
const raw = () => synth().json(STACK_NAMES.network);

const subnetsNamed = (name: string) =>
  Object.entries(resourcesOfType(raw(), 'AWS::EC2::Subnet')).filter(([, s]) =>
    JSON.stringify(s.Properties?.Tags ?? []).includes(`"Key":"aws-cdk:subnet-name","Value":"${name}"`),
  );

/** Routes attached to the route tables of the named subnet group. */
function routesFor(name: string): CfnResource[] {
  const subnetIds = new Set(subnetsNamed(name).map(([id]) => id));
  const tables = new Set(
    Object.values(resourcesOfType(raw(), 'AWS::EC2::SubnetRouteTableAssociation'))
      .filter((a) => subnetIds.has((a.Properties?.SubnetId as { Ref: string }).Ref))
      .map((a) => (a.Properties?.RouteTableId as { Ref: string }).Ref),
  );
  return Object.values(resourcesOfType(raw(), 'AWS::EC2::Route')).filter((r) =>
    tables.has((r.Properties?.RouteTableId as { Ref: string }).Ref),
  );
}

describe('Network stack', () => {
  test('is in the primary region / workload account', () => {
    const stack = synth().assembly.getStackByName(STACK_NAMES.network);
    expect(stack.environment.account).toBe('294321867941');
    expect(stack.environment.region).toBe('ca-central-1');
  });

  test('one VPC; public, app and data subnets across two pinned AZs (no context lookup)', () => {
    tpl().resourceCountIs('AWS::EC2::VPC', 1);
    for (const name of ['public', 'app', 'data']) expect(subnetsNamed(name)).toHaveLength(2);
    const azs = new Set(
      Object.values(resourcesOfType(raw(), 'AWS::EC2::Subnet')).map((s) => s.Properties?.AvailabilityZone),
    );
    expect([...azs].sort()).toEqual(['ca-central-1a', 'ca-central-1b']);
  });

  test('no NAT Gateway (aws-stack.md "Explicitly rejected"), no Elastic IP', () => {
    tpl().resourceCountIs('AWS::EC2::NatGateway', 0);
    tpl().resourceCountIs('AWS::EC2::EIP', 0);
  });

  describe('NAT instance (human decision 2026-09-18, aws-stack.md)', () => {
    test('exactly one t4g.nano instance, forwarding enabled, no key pair, IMDSv2 required', () => {
      tpl().resourceCountIs('AWS::EC2::Instance', 1);
      const [instance] = Object.values(resourcesOfType(raw(), 'AWS::EC2::Instance'));
      expect(instance?.Properties?.InstanceType).toBe('t4g.nano');
      expect(instance?.Properties?.SourceDestCheck).toBe(false);
      expect(instance?.Properties?.KeyName).toBeUndefined();
      tpl().hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({ MetadataOptions: Match.objectLike({ HttpTokens: 'required' }) }),
      });
    });

    /**
     * The first deploy (2026-09-30) booted a NAT instance that forwarded
     * nothing: CDK's default user data runs `yum install iptables-services`,
     * which the OOM killer ended on the 512 MB t4g.nano, so no MASQUERADE rule
     * was ever written and every in-VPC call to the internet failed
     * (Cognito JWKS -> Errno 99 on every authenticated route).
     */
    describe('bootstrap user data', () => {
      const natInstance = () => {
        const [entry] = Object.entries(resourcesOfType(raw(), 'AWS::EC2::Instance'));
        if (!entry) throw new Error('no NAT instance');
        return entry;
      };
      const script = () => {
        const userData = natInstance()[1].Properties?.UserData as { 'Fn::Base64'?: unknown };
        const body = userData?.['Fn::Base64'];
        if (typeof body !== 'string') throw new Error(`user data is not a literal script: ${JSON.stringify(userData)}`);
        return body;
      };

      test('stops at the first failing command, and echoes each one to the console log', () => {
        expect(script()).toMatch(/^#!\/bin\/bash\nset -euxo pipefail\n/);
      });

      test('enables swap before the package install, so dnf is not OOM-killed on 512 MB', () => {
        const s = script();
        const swapOn = s.indexOf('swapon /swapfile');
        const install = s.search(/\bdnf install\b/);
        expect(swapOn).toBeGreaterThan(-1);
        expect(install).toBeGreaterThan(swapOn);
        expect(s).not.toMatch(/\byum\b/);
      });

      test('finds the egress interface with `ip route` (AL2023 has no `route`), and refuses an empty one', () => {
        const s = script();
        expect(s).not.toMatch(/\$\(route\b/);
        expect(s).toMatch(/ip route show default/);
        expect(s).toMatch(/iptables -t nat -A POSTROUTING -o "\$\w+" -j MASQUERADE/);
        expect(s).toMatch(/\[ -n "\$\w+" \]/);
      });

      test('persists forwarding and the NAT rule across a reboot', () => {
        const s = script();
        expect(s).toContain('net.ipv4.ip_forward=1');
        expect(s).toMatch(/systemctl enable --now iptables/);
        // Not `service iptables save`: AL2023 has no /usr/sbin/service unless
        // initscripts-service is installed. The init script ships with the package.
        expect(s).toMatch(/^\/usr\/libexec\/iptables\/iptables\.init save$/m);
      });

      test('a changed script replaces the instance: cloud-init runs user data only on first boot', () => {
        const hash = crypto.createHash('sha256').update(script()).digest('hex').slice(0, 16);
        expect(natInstance()[0]).toMatch(new RegExp(`${hash}$`));
      });
    });

    /**
     * `latestAmazonLinux2023()` synthesizes an SSM-backed image parameter that
     * CloudFormation re-resolves on every deploy, so the NAT instance was
     * replaced whenever AWS published a new AMI. The AMI is pinned in cdk.json
     * (`natImageId`) instead.
     */
    describe('pinned AMI', () => {
      const SSM_IMAGE_PARAM = 'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>';
      const instancesOf = (overrides: Record<string, unknown> = {}) =>
        Object.entries(resourcesOfType(synthFanwire(overrides).json(STACK_NAMES.network), 'AWS::EC2::Instance'));
      const imageIdOf = (overrides: Record<string, unknown> = {}) => {
        const entries = instancesOf(overrides);
        expect(entries).toHaveLength(1);
        return entries[0]?.[1].Properties?.ImageId;
      };

      test('no SSM-resolved image parameter (BootstrapVersion, an SSM String, is still allowed)', () => {
        const { Parameters = {} } = raw() as { Parameters?: Record<string, { Type?: string }> };
        const ssmImageParams = Object.entries(Parameters).filter(([, p]) => p.Type === SSM_IMAGE_PARAM);
        expect(ssmImageParams).toEqual([]);
      });

      test('ImageId is the literal AMI from cdk.json', () => {
        const imageId = imageIdOf();
        expect(imageId).toBe(cdkJsonContext().natImageId);
        expect(imageId).toBe('ami-012dfd7ab44bf488a');
      });

      test('ImageId follows the natImageId context key', () => {
        expect(imageIdOf({ natImageId: 'ami-0123456789abcdef0' })).toBe('ami-0123456789abcdef0');
      });

      /**
       * The logical id carries a hash of NAT_BOOTSTRAP's rendered user data
       * (see 'a changed script replaces the instance' above). If it changes,
       * CloudFormation replaces the instance regardless of the AMI, and the
       * pin's first deploy would no longer be a no-op. This is the live stack's id.
       */
      test("logical id is the live stack's, so pinning the AMI does not replace the instance", () => {
        expect(instancesOf().map(([id]) => id)).toEqual(['VpcpublicSubnet1NatInstance6B5DA608e1d9bbdccea4f69b']);
      });
    });

    test('app subnets send 0.0.0.0/0 to the NAT instance; public subnets to the IGW; data subnets nowhere', () => {
      const app = routesFor('app');
      expect(app).toHaveLength(2);
      for (const r of app) {
        expect(r.Properties?.DestinationCidrBlock).toBe('0.0.0.0/0');
        expect(r.Properties?.InstanceId).toBeDefined();
      }
      const pub = routesFor('public');
      expect(pub).toHaveLength(2);
      for (const r of pub) expect(r.Properties?.GatewayId).toBeDefined();
      expect(routesFor('data')).toEqual([]);
    });

    test('NAT SG admits only HTTPS from the Lambda SG; nothing from any CIDR (no SSH)', () => {
      const [natSgId] = Object.entries(resourcesOfType(raw(), 'AWS::EC2::SecurityGroup')).find(([, sg]) =>
        String(sg.Properties?.GroupDescription).includes('NAT'),
      )!;
      const natSg = resourcesOfType(raw(), 'AWS::EC2::SecurityGroup')[natSgId];
      expect(natSg?.Properties?.SecurityGroupIngress).toBeUndefined();
      const ingress = Object.values(resourcesOfType(raw(), 'AWS::EC2::SecurityGroupIngress')).filter(
        (r) => JSON.stringify(r.Properties?.GroupId).includes(natSgId),
      );
      expect(ingress).toHaveLength(1);
      expect(ingress[0]?.Properties).toMatchObject({ IpProtocol: 'tcp', FromPort: 443, ToPort: 443 });
      expect(ingress[0]?.Properties?.SourceSecurityGroupId).toBeDefined();
    });

    test('NAT SG egress: HTTPS only (forwarded Lambda traffic, SSM agent, package repos)', () => {
      tpl().hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: Match.stringLikeRegexp('NAT'),
        SecurityGroupEgress: [{ CidrIp: '0.0.0.0/0', Description: Match.anyValue(), FromPort: 443, ToPort: 443, IpProtocol: 'tcp' }],
      });
    });

    test('its own role: EC2 trust, no managed policies, only the Session Manager agent statements', () => {
      const roles = Object.values(resourcesOfType(raw(), 'AWS::IAM::Role'));
      expect(roles).toHaveLength(1);
      expect(JSON.stringify(roles[0]?.Properties?.AssumeRolePolicyDocument)).toContain('ec2.amazonaws.com');
      expect(roles[0]?.Properties?.ManagedPolicyArns).toBeUndefined();
      tpl().hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: [
            Match.objectLike({
              Action: [
                'ssm:UpdateInstanceInformation',
                'ssmmessages:CreateControlChannel',
                'ssmmessages:CreateDataChannel',
                'ssmmessages:OpenControlChannel',
                'ssmmessages:OpenDataChannel',
              ],
            }),
          ],
        },
      });
    });
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
    const [dbSgId] = Object.entries(resourcesOfType(raw(), 'AWS::EC2::SecurityGroup')).find(([, sg]) =>
      String(sg.Properties?.GroupDescription).includes('RDS'),
    )!;
    const ingress = Object.values(resourcesOfType(raw(), 'AWS::EC2::SecurityGroupIngress')).filter((r) =>
      JSON.stringify(r.Properties?.GroupId).includes(dbSgId),
    );
    expect(ingress).toHaveLength(1);
    expect(ingress[0]?.Properties).toMatchObject({ IpProtocol: 'tcp', FromPort: 5432, ToPort: 5432 });
    expect(ingress[0]?.Properties?.SourceSecurityGroupId).toBeDefined();
    expect(ingress[0]?.Properties?.CidrIp).toBeUndefined();
  });

  test('Lambda SG egress: HTTPS out (via NAT / gateway endpoints) and Postgres to the DB SG only', () => {
    tpl().hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('Lambda'),
      SecurityGroupEgress: [Match.objectLike({ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0' })],
    });
    tpl().hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
      IpProtocol: 'tcp',
      FromPort: 5432,
      ToPort: 5432,
      DestinationSecurityGroupId: Match.anyValue(),
    });
  });

  test('no inbound rule anywhere opens a port to the internet', () => {
    const all = [
      ...Object.values(resourcesOfType(raw(), 'AWS::EC2::SecurityGroupIngress')).map((r) => r.Properties),
      ...Object.values(resourcesOfType(raw(), 'AWS::EC2::SecurityGroup')).flatMap(
        (r) => (r.Properties?.SecurityGroupIngress as Record<string, unknown>[] | undefined) ?? [],
      ),
    ];
    for (const rule of all) {
      expect(rule?.CidrIp).toBeUndefined();
      expect(rule?.CidrIpv6).toBeUndefined();
    }
  });

  test('no custom-resource Lambdas (e.g. restrictDefaultSecurityGroup)', () => {
    tpl().resourceCountIs('AWS::Lambda::Function', 0);
    tpl().resourceCountIs('Custom::VpcRestrictDefaultSG', 0);
  });
});
