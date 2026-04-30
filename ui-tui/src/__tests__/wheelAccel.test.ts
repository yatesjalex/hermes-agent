import { describe, expect, it } from 'vitest'

import { computeWheelStep, initWheelAccel, precisionWheelStep } from '../lib/wheelAccel.js'

describe('wheelAccel — native path', () => {
  it('first click after init returns base', () => {
    const s = initWheelAccel(false, 1)

    expect(computeWheelStep(s, 1, 1000)).toBe(1)
  })

  it('same-direction fast events ramp mult (window-mode)', () => {
    const s = initWheelAccel(false, 1)

    computeWheelStep(s, 1, 1000)
    computeWheelStep(s, 1, 1020)
    computeWheelStep(s, 1, 1040)

    // Key property: doesn't shrink below base.
    expect(computeWheelStep(s, 1, 1060)).toBeGreaterThanOrEqual(1)
  })

  it('gap beyond window resets mult to base', () => {
    const s = initWheelAccel(false, 1)

    for (let t = 1000; t < 1100; t += 20) {
      computeWheelStep(s, 1, t)
    }

    expect(computeWheelStep(s, 1, 2000)).toBe(1)
  })

  it('direction flip defers one event for bounce detection', () => {
    const s = initWheelAccel(false, 1)

    computeWheelStep(s, 1, 1000)

    expect(computeWheelStep(s, -1, 1050)).toBe(0)
  })

  it('flip-back within bounce window engages wheelMode', () => {
    const s = initWheelAccel(false, 1)

    computeWheelStep(s, 1, 1000)
    computeWheelStep(s, -1, 1050)
    computeWheelStep(s, 1, 1100)

    expect(s.wheelMode).toBe(true)
  })

  it('flip-back outside bounce window is a real reversal (no wheelMode)', () => {
    const s = initWheelAccel(false, 1)

    computeWheelStep(s, 1, 1000)
    computeWheelStep(s, -1, 1050)
    computeWheelStep(s, 1, 1400)

    expect(s.wheelMode).toBe(false)
  })

  it('5 consecutive sub-5ms events disengage wheelMode (trackpad signature)', () => {
    const s = initWheelAccel(false, 1)
    s.wheelMode = true
    s.dir = 1
    s.time = 1000

    for (let t = 1002; t <= 1010; t += 2) {
      computeWheelStep(s, 1, t)
    }

    expect(s.wheelMode).toBe(false)
  })

  it('1.5s idle disengages wheelMode', () => {
    const s = initWheelAccel(false, 1)
    s.wheelMode = true
    s.dir = 1
    s.time = 1000

    computeWheelStep(s, 1, 3000)

    expect(s.wheelMode).toBe(false)
  })
})

describe('wheelAccel — xterm.js path', () => {
  it('first click returns 2 after long idle', () => {
    const s = initWheelAccel(true, 1)

    expect(computeWheelStep(s, 1, 1000)).toBeGreaterThanOrEqual(1)
  })

  it('sub-5ms burst returns 1 (same-direction, same-batch)', () => {
    const s = initWheelAccel(true, 1)

    computeWheelStep(s, 1, 1000)

    expect(computeWheelStep(s, 1, 1002)).toBe(1)
  })

  it('slow steady scroll stays in precision range', () => {
    const s = initWheelAccel(true, 1)

    for (let t = 1000; t < 2000; t += 33) {
      const r = computeWheelStep(s, 1, t)

      expect(r).toBeGreaterThanOrEqual(1)
      expect(r).toBeLessThanOrEqual(6)
    }
  })

  it('direction reversal resets mult', () => {
    const s = initWheelAccel(true, 1)

    for (let t = 1000; t < 1100; t += 20) {
      computeWheelStep(s, 1, t)
    }

    const beforeFlip = s.mult

    computeWheelStep(s, -1, 1200)

    expect(s.mult).toBeLessThanOrEqual(beforeFlip)
    expect(s.mult).toBe(2)
  })

  it('frac stays in [0,1) across events', () => {
    const s = initWheelAccel(true, 1)

    // Correctness invariant of fractional carry: never negative, never reaches 1.
    for (let t = 1000; t < 1200; t += 30) {
      computeWheelStep(s, 1, t)

      expect(s.frac).toBeGreaterThanOrEqual(0)
      expect(s.frac).toBeLessThan(1)
    }
  })
})

describe('precisionWheelStep — modifier-held precision', () => {
  const init = (burstRate = 0.25, burstGapMs = 25) => ({
    burstGapMs,
    burstRate,
    dir: 0 as -1 | 0 | 1,
    frac: 0,
    time: 0
  })

  it('first event always commits', () => {
    const s = init()

    expect(precisionWheelStep(s, 1, 1000)).toBe(1)
  })

  it('real-wheel detents (gap >= burstGapMs) commit 1:1 — velocity-proportional', () => {
    const s = init(0.25, 25)

    // Real wheel @ ~12 detents/sec (80ms apart) — every detent should commit.
    let commits = 0

    for (let t = 1000; t <= 2000; t += 80) {
      commits += precisionWheelStep(s, 1, t)
    }

    expect(commits).toBe(13)
  })

  it('fast real-wheel spin (50ms) still commits 1:1', () => {
    const s = init(0.25, 25)
    let commits = 0

    for (let t = 1000; t <= 2000; t += 50) {
      commits += precisionWheelStep(s, 1, t)
    }

    expect(commits).toBe(21)
  })

  it('smooth-scroll detent burst commits leading edge plus fractional follow-up', () => {
    const s = init(0.25, 25)
    let commits = 0

    // Single detent: first event commits (gap from t=0 huge → leading edge),
    // 4 follow-ups within 8ms accumulate 4*0.25 = 1.0 → 1 more commit.
    for (let t = 1000; t < 1040; t += 8) {
      commits += precisionWheelStep(s, 1, t)
    }

    expect(commits).toBe(2)
  })

  it('trackpad flick (50 events @ 8ms) scales with velocity', () => {
    const s = init(0.25, 25)
    let commits = 0

    for (let t = 1000; t < 1400; t += 8) {
      commits += precisionWheelStep(s, 1, t)
    }

    // 1 leading + floor(49*0.25) follow-up commits.
    expect(commits).toBe(13)
  })

  it('direction flip commits immediately and resets carry', () => {
    const s = init(0.25, 25)

    precisionWheelStep(s, 1, 1000)

    for (let t = 1008; t < 1040; t += 8) {
      precisionWheelStep(s, 1, t)
    }

    s.frac = 0.99
    expect(precisionWheelStep(s, -1, 1042)).toBe(1)
    expect(s.frac).toBe(0)
  })

  it('burstRate = 1 disables coalescing (1:1 always)', () => {
    const s = init(1, 25)

    expect(precisionWheelStep(s, 1, 1000)).toBe(1)
    expect(precisionWheelStep(s, 1, 1005)).toBe(1)
    expect(precisionWheelStep(s, 1, 1010)).toBe(1)
  })

  it('low burstRate slows trackpad flicks proportionally', () => {
    const s = init(0.1, 25)
    let commits = 0

    for (let t = 1000; t < 1400; t += 8) {
      commits += precisionWheelStep(s, 1, t)
    }

    // 1 leading + 49*0.1 = 5.9 → 5-6 follow-ups.
    expect(commits).toBeGreaterThanOrEqual(5)
    expect(commits).toBeLessThanOrEqual(7)
  })
})
