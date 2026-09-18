import * as cdk from 'aws-cdk-lib';
import { loadConfig } from '../lib/config';
import { cdkJsonContext } from './helpers';

function configWith(overrides: Record<string, unknown>) {
  const app = new cdk.App({ context: { ...cdkJsonContext(), ...overrides } });
  return loadConfig(app.node);
}

describe('loadConfig', () => {
  test('cdk.json defaults: workload account, ca-central-1, domain set, no hosted zone', () => {
    expect(configWith({})).toEqual({
      account: '294321867941',
      region: 'ca-central-1',
      edgeRegion: 'us-east-1',
      domainName: 'fanwire.daviddems.ca',
      hostedZoneId: undefined,
      hostedZoneName: undefined,
    });
  });

  test('empty domainName means "no custom domain"', () => {
    expect(configWith({ domainName: '' }).domainName).toBeUndefined();
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
