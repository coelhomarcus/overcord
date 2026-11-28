import { describe, expect, it } from 'vitest';
import { barPath, capacityLevel, countTicks, labelEvery } from '@/features/admin/chartScale';

describe('countTicks', () => {
  it('gives an empty or all-zero series a 0–1 axis', () => {
    expect(countTicks(0)).toEqual([0, 1]);
  });

  it('steps whole numbers by 1, 2 or 5 and covers the peak', () => {
    expect(countTicks(3)).toEqual([0, 1, 2, 3]);
    expect(countTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(countTicks(37)).toEqual([0, 10, 20, 30, 40]);
    expect(countTicks(1200)).toEqual([0, 500, 1000, 1500]);
  });
});

describe('labelEvery', () => {
  it('labels every column that has room and thins the rest', () => {
    expect(labelEvery(7, 80)).toBe(1);
    expect(labelEvery(30, 20)).toBe(3);
  });
});

describe('capacityLevel', () => {
  it('turns amber from three quarters and red from nine tenths', () => {
    expect(capacityLevel(0.5)).toBe('normal');
    expect(capacityLevel(0.75)).toBe('warning');
    expect(capacityLevel(0.9)).toBe('critical');
    expect(capacityLevel(1.5)).toBe('critical');
  });
});

describe('barPath', () => {
  it('never rounds more than the bar is tall', () => {
    expect(barPath(0, 9, 10, 1)).toContain('Q 0 9 1 9');
  });
});
