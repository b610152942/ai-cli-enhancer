import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PATCH_PAIRS,
  patchCodeBuddyContent,
  unpatchCodeBuddyContent,
} from '../src/adapters/codebuddy.mjs';

test('patchCodeBuddyContent patches setRuntimeModel, setRuntimeOutputStyle, and ModelPanel', () => {
  const sampleOriginal = `
    foo();
    setRuntimeModel(ei,ea){ei&&(ei.options=ei.options??{},ei.options.model=ea,ei.requestOptions??(ei.requestOptions={}),ei.requestOptions.model=ea,this.setOverrideModel(ei.id,ea))}
    setRuntimeOutputStyle(ei,ea){ei&&(ei.options=ei.options??{},ei.options.outputStyle=ea)}
    "global"===es?(ek.current=await (0,ec.m)((0,e_.fq)(),ea,"Switch model to"),await (0,e_.fq)().set("model",ea)):ek.current=\`Switch model to \${ea} (this session only)\`,await (0,e_.HZ)().set("model",ea),(0,e_.id)().setRuntimeModel(ei,ea),ex()
    bar();
  `;

  const { content: patched, changed } = patchCodeBuddyContent(sampleOriginal);
  assert.equal(changed, true);
  assert.ok(patched.includes('this.sessionSubject?.next(ei)'));
  assert.ok(patched.includes('(0,e_.id)().setRuntimeModel(ei,ea),ex()'));

  // Idempotence test
  const secondPass = patchCodeBuddyContent(patched);
  assert.equal(secondPass.changed, false);
  assert.equal(secondPass.content, patched);

  // Unpatch test
  const { content: restored, changed: unpatchChanged } = unpatchCodeBuddyContent(patched);
  assert.equal(unpatchChanged, true);
  assert.equal(restored, sampleOriginal);

  // Unpatch idempotence
  const unpatchSecondPass = unpatchCodeBuddyContent(restored);
  assert.equal(unpatchSecondPass.changed, false);
});

test('PATCH_PAIRS contain expected replacement elements', () => {
  assert.equal(PATCH_PAIRS.length, 3);
  for (const pair of PATCH_PAIRS) {
    assert.ok(pair.target.length > 20);
    assert.ok(pair.replacement.length > 20);
    assert.notEqual(pair.target, pair.replacement);
  }
});
