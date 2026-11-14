import { Match } from 'aws-cdk-lib/assertions';
import { DOMAIN_MODES, STACK_NAMES, resourcesOfType, synthFanwire } from './helpers';

const tpl = (overrides = {}) => synthFanwire(overrides).template(STACK_NAMES.edge);

describe('Edge stack (us-east-1)', () => {
  test('lives in us-east-1, same account', () => {
    const stack = synthFanwire().assembly.getStackByName(STACK_NAMES.edge);
    expect(stack.environment.region).toBe('us-east-1');
    expect(stack.environment.account).toBe('294321867941');
  });

  test('one CLOUDFRONT-scope WebACL, default allow', () => {
    tpl().resourceCountIs('AWS::WAFv2::WebACL', 1);
    tpl().hasResourceProperties('AWS::WAFv2::WebACL', { Scope: 'CLOUDFRONT', DefaultAction: { Allow: {} } });
  });

  test('AWS managed Core, Known Bad Inputs and SQLi rule groups + a per-IP rate-based rule', () => {
    // separate assertions: arrayWith is order-sensitive, rule order is a priority choice
    for (const name of ['AWSManagedRulesCommonRuleSet', 'AWSManagedRulesKnownBadInputsRuleSet', 'AWSManagedRulesSQLiRuleSet']) {
      tpl().hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Statement: { ManagedRuleGroupStatement: { VendorName: 'AWS', Name: name } },
            OverrideAction: { None: {} },
          }),
        ]),
      });
    }
    tpl().hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({
          Action: { Block: {} },
          Statement: { RateBasedStatement: Match.objectLike({ AggregateKeyType: 'IP', Limit: Match.anyValue() }) },
        }),
      ]),
    });
  });
});

describe.each(Object.entries(DOMAIN_MODES))('Edge stack certificate (%s)', (mode, overrides) => {
  test('certificate matches the domain mode', () => {
    const t = tpl(overrides);
    const certs = resourcesOfType(synthFanwire(overrides).json(STACK_NAMES.edge), 'AWS::CertificateManager::Certificate');
    if (mode === 'no domain') {
      expect(Object.keys(certs)).toHaveLength(0);
      return;
    }
    t.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'fanwire.daviddems.com',
      ValidationMethod: 'DNS',
    });
    const [cert] = Object.values(certs);
    const options = JSON.stringify(cert?.Properties?.DomainValidationOptions ?? []);
    if (mode === 'domain with hosted zone') {
      expect(options).toContain('Z0123456789ABCDEFGHIJ');
    } else {
      // validation CNAME added by a human later: no zone to write it into
      expect(options).not.toContain('HostedZoneId');
    }
  });
});
