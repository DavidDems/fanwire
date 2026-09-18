/**
 * `cdk synth` must succeed with no AWS credentials in every domain mode:
 * no context lookups (they need credentials) and no error annotations.
 */
import { DOMAIN_MODES, synthFanwire } from './helpers';

describe.each(Object.entries(DOMAIN_MODES))('synth without credentials (%s)', (_mode, overrides) => {
  test('no missing context (nothing needs an AWS lookup at synth time)', () => {
    const synth = synthFanwire(overrides);
    expect(synth.assembly.manifest.missing ?? []).toEqual([]);
  });

  test('no error annotations on any stack', () => {
    const synth = synthFanwire(overrides);
    const errors = synth.assembly.stacks.flatMap((s) =>
      s.messages.filter((m) => m.level === 'error').map((m) => `${s.stackName} ${m.id}: ${String(m.entry.data)}`),
    );
    expect(errors).toEqual([]);
  });
});
