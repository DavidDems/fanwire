#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { buildFanwire } from '../lib/app';

// Synth-only in this repo's CI: nothing here runs `cdk deploy`. Deploy is a
// separate, human-gated step (wiki/CodeContext/Modules/0x00c-architecture-aws-account.md
// "AWS account state": GitHubActionsDeployRole can only assume the CDK bootstrap roles).
const app = new cdk.App();
buildFanwire(app);
app.synth();
