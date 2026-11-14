import * as cdk from 'aws-cdk-lib';
import { loadConfig } from '../lib/config';
import { cdkJsonContext } from './helpers';

function configWith(overrides: Record<string, unknown>) {
  const app = new cdk.App({ context: { ...cdkJsonContext(), ...overrides } });
  return loadConfig(app.node);
}

describe('loadConfig', () => {
  test('cdk.json defaults: workload account, ca-central-1, the real delegated zone', () => {
    // Pins what a bare `cdk deploy` would actually use. The zone is the real
    // one delegated from the registrar on 2026-09-22, so this asserts the
    // committed deployment config, not a placeholder.
    expect(configWith({})).toEqual({
      account: '294321867941',
      region: 'ca-central-1',
      edgeRegion: 'us-east-1',
      domainName: 'fanwire.daviddems.com',
      hostedZoneId: 'Z04139742PYZYKIOGHWGR',
      hostedZoneName: 'fanwire.daviddems.com',
      // Not in cdk.json: uploading `frontend/dist` is opt-in, because the
      // directory is gitignored and CI synthesizes without a frontend build.
      // A human deploying runs `cdk deploy -c deployFrontend=true`.
      deployFrontend: false,
      // The AMI the live NAT instance runs as of 2026-10-02, pinned so the
      // first deploy of the pin is a no-op rather than an instance replacement.
      natImageId: 'ami-012dfd7ab44bf488a',
      // In cdk.json, explicitly false: AWS refused SES production access on
      // 2026-10-03, so email notifications stay off until it is granted.
      sendEmailNotifications: false,
    });
  });

  describe('sendEmailNotifications (durable account fact; off until SES production access)', () => {
    // Read through `toMatchObject`/indexing rather than the typed property so
    // these compile before the field exists and fail as assertions.
    const flag = (overrides: Record<string, unknown>) =>
      (configWith(overrides) as unknown as Record<string, unknown>).sendEmailNotifications;

    test('absent => false', () => {
      expect(flag({ sendEmailNotifications: undefined })).toBe(false);
    });

    test.each([
      ['boolean true', true],
      ['string "true" (as `-c sendEmailNotifications=true` delivers it)', 'true'],
    ])('%s => true', (_label, value) => {
      expect(flag({ sendEmailNotifications: value })).toBe(true);
    });

    test.each([
      ['boolean false', false],
      ['string "false"', 'false'],
    ])('%s => false', (_label, value) => {
      expect(flag({ sendEmailNotifications: value })).toBe(false);
    });

    test('cdk.json writes it explicitly as false (present, not merely absent)', () => {
      const context = cdkJsonContext();
      expect(Object.prototype.hasOwnProperty.call(context, 'sendEmailNotifications')).toBe(true);
      expect(context.sendEmailNotifications).toBe(false);
    });
  });

  describe('natImageId (required; pinned NAT AMI)', () => {
    test.each([
      ['non-hex characters', 'ami-XYZ12345'],
      ['7 hex digits', 'ami-1234567'],
      ['18 hex digits', 'ami-0123456789abcdef01'],
      ['uppercase hex', 'ami-0123456789ABCDEF0'],
      ['no ami- prefix', '0123456789abcdef0'],
      ['empty', ''],
      ['whitespace only', '   '],
      ['absent', undefined],
    ])('rejects %s (%p)', (_label, natImageId) => {
      expect(() => configWith({ natImageId })).toThrow(/natImageId/);
    });

    test.each([
      ['8 hex digits (legacy)', 'ami-0123abcd'],
      ['17 hex digits', 'ami-0123456789abcdef0'],
    ])('accepts %s', (_label, natImageId) => {
      expect(configWith({ natImageId })).toMatchObject({ natImageId });
    });

    test('trims surrounding whitespace', () => {
      expect(configWith({ natImageId: '  ami-0123456789abcdef0 ' })).toMatchObject({
        natImageId: 'ami-0123456789abcdef0',
      });
    });
  });

  test('empty domainName means "no custom domain"', () => {
    // The zone keys have to be cleared alongside it: a hosted zone without a
    // domain is rejected, and cdk.json now carries a real one.
    expect(
      configWith({ domainName: '', hostedZoneId: '', hostedZoneName: '' }).domainName,
    ).toBeUndefined();
  });

  test('rejects a hosted zone without a domain', () => {
    expect(() => configWith({ domainName: '', hostedZoneId: 'Z123' })).toThrow(/requires "domainName"/);
  });

  test('rejects a non-us-east-1 edge region', () => {
    expect(() => configWith({ edgeRegion: 'ca-central-1' })).toThrow(/us-east-1/);
  });

  test('rejects a malformed account id', () => {
    expect(() => configWith({ account: '1234' })).toThrow(/12-digit/);
  });
});
