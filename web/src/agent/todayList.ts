// The Today list as a UI SDK component, so an agent (Claude Code, through Cockpit's board tools) can read it and use it.
// It draws nothing of its own: the card keeps its rows and look, and this wraps them. Its value is the list as data;
// its actions are what an agent may ask for. Each action calls back into the card, which does what a click would.
// Experimental (spike/ui-sdk-today): UI SDK is in beta.
import { definePrimitive } from '@ui-sdk/core'
import { createParts } from '@ui-sdk/react/primitive'

/** saving: just added to Todoist, not confirmed yet (its id is a temporary one) */
export type AgentTask = { id: string; task: string; done: boolean; detail?: string; saving?: boolean }

type Options = {
  value?: AgentTask[]
  onAdd?: (text: string) => void
  onComplete?: (id: string) => void
  onReopen?: (id: string) => void
  onRename?: (id: string, text: string) => void
  onRemove?: (id: string) => void
}

const words = (s: unknown) => String(s ?? '').trim()

const taskList = definePrimitive({
  name: 'task-list',
  options: { value: 'value', onAdd: 'action', onComplete: 'action', onReopen: 'action', onRename: 'action', onRemove: 'action' },
  state: (options: Options) => ({ value: options.value ?? [] }),
  sync: options => (options.value === undefined ? {} : { value: options.value }),
  api: context => {
    const tasks = () => context.store.get().value as AgentTask[]
    // a task named by its id, its exact words, or words only it contains
    const find = (which: unknown) => {
      const q = words(which).toLowerCase()
      const list = tasks()
      const all = () => list.map(t => `"${t.task}"`).join(', ') || 'none'
      if (!q) throw new Error(`Name the task. The tasks: ${all()}.`)
      const exact = list.find(t => t.id === which || t.task.toLowerCase() === q)
      const ready = (t: AgentTask) => {
        if (t.saving) throw new Error(`"${t.task}" is still being saved to Todoist. Try again in a moment.`)
        return t
      }
      if (exact) return ready(exact)
      const some = list.filter(t => t.task.toLowerCase().includes(q))
      if (some.length === 1) return ready(some[0])
      if (some.length > 1) throw new Error(`"${words(which)}" matches ${some.length} tasks: ${some.map(t => `"${t.task}"`).join(', ')}. Use more of the words.`)
      throw new Error(`No task "${words(which)}". The tasks: ${all()}.`)
    }
    const call = <K extends keyof Options>(key: K) => {
      const fn = context.options()[key]
      if (typeof fn !== 'function') throw new Error('The Today list cannot do that here.')
      return fn as NonNullable<Options[K]>
    }
    return {
      tasks,
      // UI SDK hands an argument that matches a task's words over as that task's id: words that are already on the
      // list come back here as its id, so they're refused, not added as an id
      add: (text: string) => {
        const t = words(text)
        if (!t) throw new Error("Give the new task's words.")
        const same = tasks().find(x => x.id === t || x.task.toLowerCase() === t.toLowerCase())
        if (same) throw new Error(`"${same.task}" is already on the list.`)
        call('onAdd')(t)
      },
      complete: (task: string) => {
        const t = find(task)
        if (t.done) throw new Error(`"${t.task}" is already done.`)
        call('onComplete')(t.id)
      },
      reopen: (task: string) => {
        const t = find(task)
        if (!t.done) throw new Error(`"${t.task}" isn't done.`)
        call('onReopen')(t.id)
      },
      rename: (task: string, text: string) => {
        const t = find(task)
        const named = tasks().find(x => x.id === text)
        const next = named ? named.task : words(text)
        if (!next) throw new Error('Give the new words.')
        call('onRename')(t.id, next)
      },
      remove: (task: string) => {
        call('onRemove')(find(task).id)
      },
    }
  },
  slots: slot => ({ root: slot({ attrs: () => ({ role: 'group' }) }) }),
  // the tasks as items too, so query({ text }) finds one by its words
  agent: { actions: ['add', 'complete', 'reopen', 'rename', 'remove'], items: api => api.tasks().map(t => ({ value: t.id, label: t.task })) },
})

export const { Root: TaskList } = createParts(taskList, { root: 'div' })
