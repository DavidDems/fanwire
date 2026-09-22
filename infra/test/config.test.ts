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
