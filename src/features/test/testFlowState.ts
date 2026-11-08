import { nextPlacementTask, shouldStopPlacement } from '../../training/assessment'
import type { TestRecord, TestTask, TestTaskResult, TestType } from '../../training/types'

export type TestFlowPhase = 'gate' | 'intro' | 'task-intro' | 'playing' | 'task-result' | 'finishing' | 'report' | 'error'

export interface TestFlowState {
  phase: TestFlowPhase
  type: TestType
  tasks: TestTask[]
  results: TestTaskResult[]
  /** The task being shown, played or just finished. */
  current: TestTask | null
  /** Titles of tasks dropped because their song is missing. */
  skipped: string[]
  record: TestRecord | null
  message: string | null
}

export type TestFlowAction =
  | { type: 'loaded'; tasks: TestTask[] }
  | { type: 'start' }
  | { type: 'play' }
  | { type: 'finishedTask'; result: TestTaskResult }
  | { type: 'skipTask'; taskId: string }
  | { type: 'next' }
  | { type: 'done'; record: TestRecord }
  | { type: 'fail'; message: string }

export function initialTestFlowState(type: TestType): TestFlowState {
  return {
    phase: 'gate',
    type,
    tasks: [],
    results: [],
    current: null,
    skipped: [],
    record: null,
    message: null,
  }
}

/** The next unanswered task according to the test type's rule (placement stops after two consecutive fails). */
export function nextTask(tasks: TestTask[], results: TestTaskResult[], type: TestType): TestTask | null {
  if (type === 'placement') return nextPlacementTask(tasks, results)
  const done = new Set(results.map((r) => r.taskId))
  return tasks.find((t) => !done.has(t.id)) ?? null
}

export function currentTask(state: TestFlowState): TestTask | null {
  return state.current
}

/** True when no further task should be played. */
export function isComplete(state: TestFlowState, type: TestType = state.type): boolean {
  if (type === 'placement' && shouldStopPlacement(state.results)) return true
  return nextTask(state.tasks, state.results, type) === null
}

/** 1-based position of the current task and the number of tasks still possible. */
export function progressOf(state: TestFlowState): {
  position: number
  total: number
} {
  return {
    position: state.results.length + (state.phase === 'task-result' ? 0 : 1),
    total: state.tasks.length,
  }
}

export function testFlowReducer(state: TestFlowState, action: TestFlowAction): TestFlowState {
  switch (action.type) {
    case 'loaded': {
      if (state.phase !== 'gate') return state
      return {
        ...state,
        phase: 'intro',
        tasks: action.tasks,
        results: [],
        skipped: [],
        current: nextTask(action.tasks, [], state.type),
      }
    }
    case 'start':
      if (state.phase !== 'intro' || state.current === null) return state
      return { ...state, phase: 'task-intro' }
    case 'play':
      if (state.phase !== 'task-intro') return state
      return { ...state, phase: 'playing' }
    case 'finishedTask': {
      if (state.phase !== 'playing' || state.current === null) return state
      return {
        ...state,
        phase: 'task-result',
        results: [...state.results, action.result],
      }
    }
    case 'skipTask': {
      if (state.phase !== 'task-intro' && state.phase !== 'playing') return state
      const dropped = state.tasks.find((t) => t.id === action.taskId)
      if (!dropped) return state
      const tasks = state.tasks.filter((t) => t.id !== action.taskId)
      const skipped = [...state.skipped, dropped.title]
      const upcoming = nextTask(tasks, state.results, state.type)
      if (upcoming === null) return { ...state, tasks, skipped, current: null, phase: 'finishing' }
      return {
        ...state,
        tasks,
        skipped,
        current: upcoming,
        phase: 'task-intro',
      }
    }
    case 'next': {
      if (state.phase !== 'task-result') return state
      const upcoming = nextTask(state.tasks, state.results, state.type)
      if (upcoming === null) return { ...state, current: null, phase: 'finishing' }
      return { ...state, current: upcoming, phase: 'task-intro' }
    }
    case 'done':
      if (state.phase !== 'finishing') return state
      return { ...state, phase: 'report', record: action.record }
    case 'fail':
      return { ...state, phase: 'error', message: action.message }
    default:
      return state
  }
}
