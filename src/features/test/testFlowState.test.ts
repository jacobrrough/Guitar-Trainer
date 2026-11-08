import { describe, expect, it } from 'vitest'
import { TEST_PASS } from '../../training/constants'
import type { AttemptResult, TestRecord, TestTask, TestTaskResult } from '../../training/types'
import { currentTask, initialTestFlowState, isComplete, testFlowReducer, type TestFlowAction, type TestFlowState } from './testFlowState'

function task(i: number): TestTask {
  return {
    id: `t${i}`,
    title: `Task ${i}`,
    instructions: '',
    skillIds: ['fret.single-string'],
    generatorId: 'melody',
    params: { tempo: 70, bars: 4 },
    difficulty: 30,
    passCriteria: { ...TEST_PASS },
  }
}

function result(taskId: string, passed: boolean): TestTaskResult {
  const attempt = {
    perfects: 0,
    goods: 0,
    misses: 0,
    total: 0,
  } as unknown as TestTaskResult['attempt'] & AttemptResult
  return { taskId, attempt, passed }
}

function run(state: TestFlowState, actions: TestFlowAction[]): TestFlowState {
  return actions.reduce(testFlowReducer, state)
}

function playTask(state: TestFlowState, passed: boolean): TestFlowState {
  const id = currentTask(state)?.id as string
  return run(state, [{ type: 'play' }, { type: 'finishedTask', result: result(id, passed) }, { type: 'next' }])
}

describe('testFlowReducer', () => {
  const tasks = [1, 2, 3, 4, 5].map(task)

  it('moves gate -> intro -> task-intro -> playing -> task-result', () => {
    let s = initialTestFlowState('checkpoint')
    expect(s.phase).toBe('gate')
    s = run(s, [{ type: 'loaded', tasks }])
    expect(s.phase).toBe('intro')
    s = run(s, [{ type: 'start' }])
    expect(s.phase).toBe('task-intro')
    s = run(s, [{ type: 'play' }])
    expect(s.phase).toBe('playing')
    s = run(s, [{ type: 'finishedTask', result: result('t1', true) }])
    expect(s.phase).toBe('task-result')
    expect(s.results).toHaveLength(1)
  })

  it('placement stops after two consecutive fails', () => {
    let s = run(initialTestFlowState('placement'), [{ type: 'loaded', tasks }, { type: 'start' }])
    s = playTask(s, true)
    s = playTask(s, false)
    expect(s.phase).toBe('task-intro')
    expect(isComplete(s)).toBe(false)
    s = playTask(s, false)
    expect(s.phase).toBe('finishing')
    expect(s.results).toHaveLength(3)
  })

  it('placement does not stop on non-consecutive fails', () => {
    let s = run(initialTestFlowState('placement'), [{ type: 'loaded', tasks }, { type: 'start' }])
    s = playTask(s, false)
    s = playTask(s, true)
    s = playTask(s, false)
    expect(s.phase).toBe('task-intro')
    expect(currentTask(s)?.id).toBe('t4')
  })

  it('checkpoint runs all tasks even after fails', () => {
    let s = run(initialTestFlowState('checkpoint'), [{ type: 'loaded', tasks }, { type: 'start' }])
    for (let i = 0; i < 4; i++) {
      s = playTask(s, false)
      expect(s.phase).toBe('task-intro')
    }
    s = playTask(s, false)
    expect(s.phase).toBe('finishing')
    expect(s.results).toHaveLength(5)
  })

  it('next after the last task goes to finishing, then done to report', () => {
    let s = run(initialTestFlowState('monthly'), [{ type: 'loaded', tasks: [task(1)] }, { type: 'start' }, { type: 'play' }])
    s = run(s, [{ type: 'finishedTask', result: result('t1', true) }])
    expect(isComplete(s)).toBe(true)
    s = run(s, [{ type: 'next' }])
    expect(s.phase).toBe('finishing')
    const record = {
      at: 1,
      type: 'monthly',
      tasks: [],
      results: [],
      report: { headline: 'h', lines: [], ratingDeltas: {}, nextFocus: [] },
    } as TestRecord
    s = run(s, [{ type: 'done', record }])
    expect(s.phase).toBe('report')
    expect(s.record).toBe(record)
  })

  it('skipTask drops the task and notes it', () => {
    let s = run(initialTestFlowState('checkpoint'), [{ type: 'loaded', tasks: [task(1), task(2)] }, { type: 'start' }])
    s = run(s, [{ type: 'skipTask', taskId: 't1' }])
    expect(s.tasks.map((t) => t.id)).toEqual(['t2'])
    expect(s.skipped).toEqual(['Task 1'])
    expect(currentTask(s)?.id).toBe('t2')
    s = run(s, [{ type: 'skipTask', taskId: 't2' }])
    expect(s.phase).toBe('finishing')
  })

  it('fail moves to error and ignores out-of-order actions', () => {
    const s = testFlowReducer(initialTestFlowState('placement'), {
      type: 'play',
    })
    expect(s.phase).toBe('gate')
    expect(testFlowReducer(s, { type: 'fail', message: 'boom' })).toMatchObject({ phase: 'error', message: 'boom' })
  })
})
