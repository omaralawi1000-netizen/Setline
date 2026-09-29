import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinedGlass, segmentValue } from '../js/ui/motiongeometry.js';

test('retargeting starts at the current value and reaches either endpoint', () => {
  for (const from of [.02,.19,.46,.73,.98]) for (const to of [0,1]) {
    assert.equal(segmentValue(from,to,0,300),from);
    assert.equal(segmentValue(from,to,300,300),to);
    assert.equal(segmentValue(from,to,600,300),to);
    let previous=from;
    for (let t=1;t<=300;t++) {
      const value=segmentValue(from,to,t,300);
      assert.ok(value>=Math.min(from,to) && value<=Math.max(from,to));
      assert.ok(to ? value>=previous : value<=previous);
      previous=value;
    }
  }
});

test('glass contours keep their topology and stay inside both phone-sized housings', () => {
  for (const width of [288,358,398]) {
    let topology;
    for (let i=0;i<=100;i++) {
      const path=joinedGlass(width,72,width-88,i/100);
      const commands=path.replace(/[-\d.\s]/g,'');
      topology ??= commands; assert.equal(commands,topology);
      const values=path.match(/-?\d+(?:\.\d+)?/g).map(Number);
      assert.ok(values.every(Number.isFinite));
      for (let j=0;j<values.length;j+=2) {
        assert.ok(values[j]>=0 && values[j]<=width);
        assert.ok(values[j+1]>=0 && values[j+1]<=72);
      }
    }
  }
});
