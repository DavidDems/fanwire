import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

/** CDK's own context key, set in cdk.json: `{ "name": "FanwireRoleBoundary" }`. */
const BOUNDARY_CONTEXT_KEY = '@aws-cdk/core:permissionsBoundary';

/**
 * Gives every `AWS::IAM::Role` in `app` the permissions boundary named in
 * cdk.json, including the ones CDK's own context key misses.
 *
 * The key reaches every `iam.Role`. It does not reach the roles of CDK's
 * cross-region export writer and reader (`Custom::CrossRegionExport*`): they
 * are raw `CfnResource`s, created while references are resolved, which is
 * after Aspects have run. So this hooks the validation phase instead. It runs
 * after references are resolved and before templates are written, and it
 * changes only roles that have no boundary yet.
 *
 * Every role must carry one: `cfn-exec-role` refuses to create a role without
 * it, or to write a policy to one (infra/iam/README.md).
 */
export function boundEveryRole(app: cdk.App): void {
  const context = app.node.tryGetContext(BOUNDARY_CONTEXT_KEY) as { name?: string } | undefined;
  const name = context?.name;
  if (!name) throw new Error(`context "${BOUNDARY_CONTEXT_KEY}" must name the role boundary policy`);

  for (const stack of app.node.children.filter(cdk.Stack.isStack)) {
    stack.node.addValidation({
      validate: () => {
        const arn = stack.formatArn({ service: 'iam', region: '', resource: 'policy', resourceName: name });
        for (const node of stack.node.findAll()) {
          if (!cdk.CfnResource.isCfnResource(node) || node.cfnResourceType !== 'AWS::IAM::Role') continue;
          if (node instanceof iam.CfnRole && node.permissionsBoundary !== undefined) continue;
          node.addPropertyOverride('PermissionsBoundary', arn);
        }
        return [];
      },
    });
  }
}
