import * as cdk from 'aws-cdk-lib';
import { FanwireConfig, loadConfig } from './config';

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
 * Builds every fanwire stack into `app`. Stacks are added here one at a
 * time as they are implemented; see wiki/CodeContext/Modules/0x00-architecture.md
 * "Infra (CDK) — implementation notes" for why the split is what it is.
 */
export function buildFanwire(app: cdk.App): FanwireConfig {
  const config = loadConfig(app.node);
  return config;
}
