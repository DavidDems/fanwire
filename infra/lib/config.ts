import { Node } from 'constructs';

/**
 * Deployment configuration, read from CDK context (defaults in cdk.json,
 * override per-invocation with `-c key=value`). Nothing here is a secret:
 * account IDs and domain names are identifiers, not credentials.
 */
export interface FanwireConfig {
  /** Workload account (`fanwire-workload`). */
  readonly account: string;
  /** Primary region for everything except CloudFront-scoped pieces. */
  readonly region: string;
  /** Region for the CloudFront ACM certificate and CLOUDFRONT-scope WAF. Must be us-east-1. */
  readonly edgeRegion: string;
  /**
   * Public site domain. Undefined = serve from the distribution's default
   * `*.cloudfront.net` domain with no certificate (the domain isn't purchased yet).
   */
  readonly domainName?: string;
  /**
   * Route 53 hosted zone for `domainName`. Undefined with a domainName set =
   * the ACM certificate is created with DNS validation but the validation
   * CNAME is added by a human; no alias records are created.
   */
  readonly hostedZoneId?: string;
  /** Apex name of the hosted zone (e.g. `daviddems.com`). Defaults to domainName. */
  readonly hostedZoneName?: string;
  /**
   * Upload `frontend/dist` to the frontend bucket as part of the CloudFront
   * stack. Off unless asked for: the directory is a gitignored build output and
   * the asset is resolved at synth time, so CI (which never builds the
   * frontend) must synthesize without it. A human deploying the SPA builds it
   * first and runs `cdk deploy -c deployFrontend=true`.
   */
  readonly deployFrontend: boolean;
}

function readString(node: Node, key: string): string | undefined {
  const raw: unknown = node.tryGetContext(key);
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).trim();
  return value === '' ? undefined : value;
}

/**
 * A boolean context flag, absent meaning false.
 *
 * `-c key=true` on the CDK CLI arrives as the *string* `"true"`, while
 * `cdk.json` or a test App gives a real boolean, so both have to be accepted --
 * a boolean-only reader would make the documented deploy command silently do
 * nothing. Only `true`/`"true"` (case- and whitespace-insensitive) turn a flag
 * on; anything else, including `"false"`, `"0"` and `"no"`, leaves it off.
 */
function readBoolean(node: Node, key: string): boolean {
  const raw: unknown = node.tryGetContext(key);
  if (typeof raw === 'boolean') return raw;
  if (raw === undefined || raw === null) return false;
  return String(raw).trim().toLowerCase() === 'true';
}

export function loadConfig(node: Node): FanwireConfig {
  const account = readString(node, 'account');
  const region = readString(node, 'region');
  const edgeRegion = readString(node, 'edgeRegion') ?? 'us-east-1';
  const domainName = readString(node, 'domainName');
  const hostedZoneId = readString(node, 'hostedZoneId');
  const hostedZoneName = readString(node, 'hostedZoneName');
  const deployFrontend = readBoolean(node, 'deployFrontend');

  if (!account || !/^\d{12}$/.test(account)) {
    throw new Error(`context "account" must be a 12-digit AWS account id, got ${JSON.stringify(account)}`);
  }
  if (!region) {
    throw new Error('context "region" is required');
  }
  if (edgeRegion !== 'us-east-1') {
    throw new Error('context "edgeRegion" must be us-east-1: CloudFront only accepts ACM certs and WAF WebACLs from there');
  }
  if (hostedZoneId && !domainName) {
    throw new Error('context "hostedZoneId" requires "domainName"');
  }
  if (hostedZoneName && !hostedZoneId) {
    throw new Error('context "hostedZoneName" requires "hostedZoneId"');
  }
  if (domainName && !/^[a-z0-9.-]+$/.test(domainName)) {
    throw new Error(`context "domainName" is not a valid lowercase DNS name: ${domainName}`);
  }

  return { account, region, edgeRegion, domainName, hostedZoneId, hostedZoneName, deployFrontend };
}
