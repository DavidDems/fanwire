import * as cdk from 'aws-cdk-lib';
import { FanwireConfig, loadConfig } from './config';
import { NetworkStack } from './network-stack';

/** Stack names, shared with the tests so they can look each one up in the cloud assembly. */
export const STACK_NAMES = {
  edge: 'Fanwire-Edge',
  network: 'Fanwire-Network',
  data: 'Fanwire-Data',
  auth: 'Fanwire-Auth',
  storage: 'Fanwire-Storage',
  messaging: 'Fanwire-Messaging',
  app: 'Fanwire-App',
  cdn: 'Fanwire-Cdn',
} as const;

/**
 * Builds every fanwire stack into `app`. See
 * wiki/CodeContext/Modules/0x00-architecture.md "Infra (CDK) — implementation
 * notes" for why the split is what it is.
 */
export function buildFanwire(app: cdk.App): FanwireConfig {
  const config = loadConfig(app.node);
  const env = { account: config.account, region: config.region };
  cdk.Tags.of(app).add('project', 'fanwire');

  new NetworkStack(app, STACK_NAMES.network, {
    env,
    description: 'fanwire: dual-stack VPC, egress-only IGW, gateway endpoints, security groups (no NAT)',
  });

  return config;
}
