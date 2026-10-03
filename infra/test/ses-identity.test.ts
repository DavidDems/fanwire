import { DOMAIN_MODES, STACK_NAMES, resourcesOfType, synthFanwire, CfnResource } from './helpers';

/**
 * The notifications Lambda is granted `ses:SendEmail` on
 * `identity/<domainName>` and sends from `notifications@<domainName>` -- but a
 * grant on an identity that does not exist sends nothing. Production's
 * `GetEmailIdentity fanwire.daviddems.com` returned NotFoundException.
 *
 * The identity lives in the App stack, next to the grant that uses it, and is
 * verified with Easy DKIM: its three DKIM CNAMEs are published into the hosted
 * zone the app already manages. Without a zone nothing could verify it, so no
 * identity is created at all.
 */

const SES_IDENTITY = 'AWS::SES::EmailIdentity';
const RECORD_SET = 'AWS::Route53::RecordSet';

const HOSTED = DOMAIN_MODES['domain with hosted zone'];

/** Every `Fn::GetAtt` reference anywhere inside `value`, as `[logicalId, attribute]`. */
function getAtts(value: unknown): Array<[string, string]> {
  if (Array.isArray(value)) return value.flatMap(getAtts);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const ga = obj['Fn::GetAtt'];
    if (Array.isArray(ga) && typeof ga[0] === 'string' && typeof ga[1] === 'string') {
      return [[ga[0], ga[1]]];
    }
    return Object.values(obj).flatMap(getAtts);
  }
  return [];
}

function identitiesIn(stackName: string, overrides: Record<string, unknown>): Record<string, CfnResource> {
  return resourcesOfType(synthFanwire(overrides).json(stackName), SES_IDENTITY);
}

describe('SES domain identity (domain with hosted zone)', () => {
  const app = () => synthFanwire(HOSTED).json(STACK_NAMES.app);

  test('the App stack holds exactly one identity, for the site domain -- not the zone apex', () => {
    const identities = Object.values(resourcesOfType(app(), SES_IDENTITY));
    expect(identities).toHaveLength(1);
    expect(identities[0].Properties?.EmailIdentity).toBe('fanwire.daviddems.com');
  });

  test('DKIM signing is not disabled', () => {
    const identities = Object.values(resourcesOfType(app(), SES_IDENTITY));
    expect(identities).toHaveLength(1);
    const dkim = identities[0].Properties?.DkimAttributes as Record<string, unknown> | undefined;
    if (dkim && 'SigningEnabled' in dkim) {
      expect(dkim.SigningEnabled).not.toBe(false);
    }
  });

  test("the identity's three DKIM CNAMEs are published into the managed hosted zone", () => {
    const identityIds = Object.keys(resourcesOfType(app(), SES_IDENTITY));
    expect(identityIds).toHaveLength(1);
    const [identityId] = identityIds;

    const cnames = Object.values(resourcesOfType(app(), RECORD_SET)).filter(
      (r) => r.Properties?.Type === 'CNAME',
    );
    expect(cnames).toHaveLength(3);

    const pairs = cnames.map((r) => {
      expect(r.Properties?.HostedZoneId).toBe(HOSTED.hostedZoneId);
      const names = getAtts(r.Properties?.Name).filter(([id]) => id === identityId);
      const values = getAtts(r.Properties?.ResourceRecords).filter(([id]) => id === identityId);
      expect(names).toHaveLength(1);
      expect(values).toHaveLength(1);
      const n = names[0][1].match(/^DkimDNSTokenName([123])$/)?.[1];
      const v = values[0][1].match(/^DkimDNSTokenValue([123])$/)?.[1];
      expect(n).toBeDefined();
      // Each record pairs a token name with *its own* token value.
      expect(v).toBe(n);
      return n;
    });

    expect([...pairs].sort()).toEqual(['1', '2', '3']);
  });
});

test('the identity and its three DKIM CNAMEs do not depend on sendEmailNotifications', () => {
  // Sending is switched off until SES production access is granted, but the
  // identity stays verified so turning sending back on is a one-flag change.
  const t = synthFanwire({ ...HOSTED, sendEmailNotifications: false }).json(STACK_NAMES.app);
  const identities = Object.values(resourcesOfType(t, SES_IDENTITY));
  expect(identities).toHaveLength(1);
  expect(identities[0].Properties?.EmailIdentity).toBe('fanwire.daviddems.com');
  expect(Object.values(resourcesOfType(t, RECORD_SET)).filter((r) => r.Properties?.Type === 'CNAME')).toHaveLength(3);
});

describe.each(['domain without hosted zone', 'no domain'])('SES domain identity (%s)', (mode) => {
  test('no identity in any stack: nothing could verify it without a hosted zone', () => {
    const synth = synthFanwire(DOMAIN_MODES[mode]);
    for (const stackName of synth.stackNames()) {
      expect([stackName, Object.keys(identitiesIn(stackName, DOMAIN_MODES[mode]))]).toEqual([stackName, []]);
    }
  });
});

describe.each(Object.entries(DOMAIN_MODES))('SES domain identity placement (%s)', (_mode, overrides) => {
  test('no stack other than App contains an SES identity', () => {
    const synth = synthFanwire(overrides);
    const others = synth.stackNames().filter((s) => s !== STACK_NAMES.app);
    expect(others.length).toBeGreaterThan(0);
    for (const stackName of others) {
      expect([stackName, Object.keys(identitiesIn(stackName, overrides))]).toEqual([stackName, []]);
    }
  });
});
