import * as cdk from 'aws-cdk-lib';
import { FanwireConfig, loadConfig } from './config';
import { AppStack } from './app-stack';
import { AuthStack } from './auth-stack';
import { DataStack } from './data-stack';
import { EdgeStack } from './edge-stack';
import { MessagingStack } from './messaging-stack';
import { NetworkStack } from './network-stack';
import { StorageStack } from './storage-stack';

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

  new EdgeStack(app, STACK_NAMES.edge, {
    env: { account: config.account, region: config.edgeRegion },
    config,
    crossRegionReferences: true,
    description: 'fanwire: CloudFront-scoped WAF WebACL and ACM certificate (must be us-east-1)',
  });

  const network = new NetworkStack(app, STACK_NAMES.network, {
    env,
    description: 'fanwire: VPC, single NAT instance (no NAT Gateway), gateway endpoints, security groups',
  });

  const data = new DataStack(app, STACK_NAMES.data, {
    env,
    network,
    description: 'fanwire: CMK, RDS Postgres, DynamoDB tables, Secrets Manager secrets',
  });

  const auth = new AuthStack(app, STACK_NAMES.auth, {
    env,
    description: 'fanwire: Cognito user pool and SPA client',
  });

  const storage = new StorageStack(app, STACK_NAMES.storage, {
    env,
    config,
    key: data.key,
    description: 'fanwire: quarantine / public-media / frontend buckets, GuardDuty Malware Protection plan',
  });

  const messaging = new MessagingStack(app, STACK_NAMES.messaging, {
    env,
    key: data.key,
    quarantineBucket: storage.quarantineBucket,
    description: 'fanwire: PostEventBus, SQS queues + DLQs, EventBridge rules',
  });

  new AppStack(app, STACK_NAMES.app, {
    env,
    config,
    network,
    data,
    auth,
    storage,
    messaging,
    description: 'fanwire: shared backend Lambda image, four functions, HTTP API, schedules and queue triggers',
  });

  return config;
}
