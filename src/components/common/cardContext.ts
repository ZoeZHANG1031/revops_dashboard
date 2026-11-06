import { createContext } from 'react'

/** True inside a card — nested Collapsibles / ChartCards render inline instead of as another card */
export const CardNestingContext = createContext(false)
