import { Match } from 'aws-cdk-lib/assertions';
import { DOMAIN_MODES, STACK_NAMES, resourcesOfType, synthFanwire, CfnResource } from './helpers';

const tpl = (o = {}) => synthFanwire(o).template(STACK_NAMES.cdn);
const raw = (o = {}) => synthFanwire(o).json(STACK_NAMES.cdn);

const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';
const ALL_VIEWER_EXCEPT_HOST = 'b689b0a8-53d0-40ab-baf2-68738e2966ac';

function distributionConfig(o = {}): Record<string, unknown> {
  const [dist] = Object.values(resourcesOfType(raw(o), 'AWS::CloudFront::Distribution'));
  return dist?.Properties?.DistributionConfig as Record<string, unknown>;
}
const behaviors = () => (distributionConfig().CacheBehaviors as Record<string, unknown>[]) ?? [];
const behavior = (pattern: string) => behaviors().find((b) => b.PathPattern === pattern)!;
const originById = (id: unknown) =>
  (distributionConfig().Origins as Record<string, unknown>[]).find((o) => o.Id === id)!;

/** Runs a CloudFront Function's source against a viewer-request event. */
function runFunction(fnResource: CfnResource, uri: string): string {
  const code = fnResource.Properties?.FunctionCode as string;
  const handler = new Function(`${code}\nreturn handler;`)() as (e: unknown) => { uri: string };
  return handler({ request: { uri, headers: {}, querystring: {} } }).uri;
}
function functionAssociatedWith(b: Record<string, unknown>): CfnResource {
  const assoc = (b.FunctionAssociations as { EventType: string; FunctionARN: { 'Fn::GetAtt': string[] } }[])[0]!;
  expect(assoc.EventType).toBe('viewer-request');
  return resourcesOfType(raw(), 'AWS::CloudFront::Function')[assoc.FunctionARN['Fn::GetAtt'][0]!]!;
}

describe('CDN stack', () => {
  test('one distribution: the only public entry, WAF attached, HTTPS only, SPA root', () => {
    tpl().resourceCountIs('AWS::CloudFront::Distribution', 1);
    const cfg = distributionConfig();
    expect(cfg.WebACLId).toBeDefined();
    expect(cfg.DefaultRootObject).toBe('index.html');
    expect(cfg.PriceClass).toBe('PriceClass_100');
    for (const b of [cfg.DefaultCacheBehavior as Record<string, unknown>, ...behaviors()]) {
      expect(b.ViewerProtocolPolicy).toBe('redirect-to-https');
    }
  });

  test('no distribution-wide error rewriting (it would turn API 403/404 JSON into index.html)', () => {
    expect(distributionConfig().CustomErrorResponses).toBeUndefined();
  });

  describe('default behaviour: frontend bucket', () => {
    test('S3 origin via OAC, cached, security headers', () => {
      const def = distributionConfig().DefaultCacheBehavior as Record<string, unknown>;
      expect(def.CachePolicyId).toBe(CACHING_OPTIMIZED);
      expect(def.ResponseHeadersPolicyId).toBeDefined();
      const origin = originById(def.TargetOriginId);
      expect(origin.OriginAccessControlId).toBeDefined();
      expect(JSON.stringify(origin.DomainName)).toContain('FrontendBucket');
    });

    test('SPA fallback: extension-less paths are rewritten to /index.html at the edge', () => {
      const f = functionAssociatedWith(distributionConfig().DefaultCacheBehavior as Record<string, unknown>);
      expect(runFunction(f, '/feed')).toBe('/index.html');
      expect(runFunction(f, '/users/42/followers')).toBe('/index.html');
      expect(runFunction(f, '/assets/index-abc123.js')).toBe('/assets/index-abc123.js');
      expect(runFunction(f, '/favicon.ico')).toBe('/favicon.ico');
    });
  });

  describe('/api/* behaviour: HTTP API', () => {
    test('uncached, all methods, forwards Authorization + query strings (AllViewerExceptHostHeader)', () => {
      const b = behavior('/api/*');
      expect(b.CachePolicyId).toBe(CACHING_DISABLED);
      expect(b.OriginRequestPolicyId).toBe(ALL_VIEWER_EXCEPT_HOST);
      expect(b.AllowedMethods).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']));
    });

    test('origin is execute-api over TLS1.2+, with the origin-verify header from Secrets Manager (never a literal)', () => {
      const origin = originById(behavior('/api/*').TargetOriginId);
      expect(JSON.stringify(origin.DomainName)).toContain('execute-api');
      expect(origin.CustomOriginConfig).toEqual(
        expect.objectContaining({ OriginProtocolPolicy: 'https-only', OriginSSLProtocols: ['TLSv1.2'] }),
      );
      const headers = origin.OriginCustomHeaders as { HeaderName: string; HeaderValue: unknown }[];
      expect(headers).toHaveLength(1);
      expect(headers[0]?.HeaderName).toBe('x-origin-verify');
      expect(JSON.stringify(headers[0]?.HeaderValue)).toContain('{{resolve:secretsmanager:');
    });

    test('a viewer-request CloudFront Function strips the /api prefix (FastAPI routes have none)', () => {
      const f = functionAssociatedWith(behavior('/api/*'));
      expect(runFunction(f, '/api/users/me')).toBe('/users/me');
      expect(runFunction(f, '/api/health')).toBe('/health');
      expect(runFunction(f, '/api/')).toBe('/');
      expect(runFunction(f, '/api')).toBe('/');
      expect(runFunction(f, '/apiary')).toBe('/apiary');
    });
  });

  test('/media/* behaviour: public-media bucket via OAC, cached', () => {
    const b = behavior('/media/*');
    expect(b.CachePolicyId).toBe(CACHING_OPTIMIZED);
    const origin = originById(b.TargetOriginId);
    expect(origin.OriginAccessControlId).toBeDefined();
    expect(JSON.stringify(origin.DomainName)).toContain('PublicMediaBucket');
  });

  test('the quarantine bucket is never an origin', () => {
    expect(JSON.stringify(distributionConfig().Origins)).not.toContain('QuarantineBucket');
  });

  test('frontend + public-media bucket policies: TLS only, CloudFront GetObject from THIS distribution only', () => {
    const policies = Object.values(resourcesOfType(raw(), 'AWS::S3::BucketPolicy'));
    expect(policies).toHaveLength(2);
    for (const p of policies) {
      const doc = p.Properties?.PolicyDocument as { Statement: Record<string, unknown>[] };
      expect(doc.Statement).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ Effect: 'Deny', Action: 's3:*', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
          expect.objectContaining({
            Effect: 'Allow',
            Principal: { Service: 'cloudfront.amazonaws.com' },
            Action: 's3:GetObject',
            Condition: { StringEquals: { 'AWS:SourceArn': expect.anything() } },
          }),
        ]),
      );
      expect(JSON.stringify(doc)).toContain('Distribution');
    }
  });

  test('outputs the values the frontend build needs', () => {
    const outputs = raw().Outputs ?? {};
    expect(Object.keys(outputs)).toEqual(
      expect.arrayContaining(['DistributionDomainName', 'DistributionId', 'SiteUrl', 'ApiBaseUrl']),
    );
    expect((outputs.ApiBaseUrl as { Value: string }).Value).toBe('/api');
  });
});

describe.each(Object.entries(DOMAIN_MODES))('CDN stack domain mode (%s)', (mode, overrides) => {
  test('aliases, certificate, TLS policy and DNS records match the mode', () => {
    const cfg = distributionConfig(overrides);
    const cert = cfg.ViewerCertificate as Record<string, unknown> | undefined;
    const records = [
      ...Object.values(resourcesOfType(raw(overrides), 'AWS::Route53::RecordSet')),
    ].map((r) => r.Properties?.Type);
    if (mode === 'no domain') {
      expect(cfg.Aliases).toBeUndefined();
      expect(cert?.AcmCertificateArn).toBeUndefined();
      expect(records).toEqual([]);
      return;
    }
    expect(cfg.Aliases).toEqual(['fanwire.daviddems.ca']);
    expect(cert).toEqual(
      expect.objectContaining({ MinimumProtocolVersion: 'TLSv1.2_2021', SslSupportMethod: 'sni-only' }),
    );
    expect(cert?.AcmCertificateArn).toBeDefined();
    if (mode === 'domain with hosted zone') {
      expect(records.sort()).toEqual(['A', 'AAAA']);
      tpl(overrides).hasResourceProperties('AWS::Route53::RecordSet', {
        HostedZoneId: 'Z0123456789ABCDEFGHIJ',
        Name: 'fanwire.daviddems.ca.',
        AliasTarget: Match.objectLike({ HostedZoneId: Match.anyValue() }),
      });
    } else {
      expect(records).toEqual([]);
    }
  });
});
