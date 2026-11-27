import { Fragment } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { keyList } from '../platform'

/** A shortcut's keys, each in its own box, as this keyboard names them: Ctrl K, or ⌘ K on a Mac. */
export function KeyCaps({ keys }: { keys: string[] }) {
  return (
    <>
      {keyList(keys).map((k, i) => (
        <Fragment key={k}>
          {i > 0 && ' '}
          <Kbd>{k}</Kbd>
        </Fragment>
      ))}
    </>
  )
}
