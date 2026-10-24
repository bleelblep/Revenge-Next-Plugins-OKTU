import { getModuleWithImportedPath } from '@revenge-mod/discord/utils/modules/finders'
import * as React from 'react'
import type { Rect } from '../shared/chatFloaters'

const PATH = 'components_native/chat/JumpToPresentButton.tsx'

export const jumpStatus = { hooked: false, moduleId: -1, lastError: '' }

let node: any
let poll: ReturnType<typeof setInterval> | undefined
let rect: Rect | undefined
const listeners = new Set<() => void>()

function setRect(next: Rect | undefined) {
	if (rect === next) return
	if (rect && next && rect.x === next.x && rect.y === next.y && rect.width === next.width && rect.height === next.height) return
	rect = next
	for (const listener of listeners) listener()
}

function measure() {
	try {
		node?.measureInWindow?.((x: number, y: number, width: number, height: number) => {
			if (width > 0 && height > 0) setRect({ x, y, width, height })
		})
	} catch {}
}

/** Where the Jump To Present button (with anything stacked on it) is in the window, while shown. */
export function useJumpToPresentRect(): Rect | undefined {
	const [, setTick] = React.useState(0)
	React.useEffect(() => {
		const listener = () => setTick(n => n + 1)
		listeners.add(listener)
		return () => {
			listeners.delete(listener)
		}
	}, [])
	return rect
}

/** The container's ref: follows it while it's on screen (it moves with the keyboard). */
function track(next: any) {
	node = next
	if (next) {
		poll ??= setInterval(measure, 500)
		measure()
	} else {
		if (poll) clearInterval(poll)
		poll = undefined
		setRect(undefined)
	}
}

/**
 * Follows Discord's Jump To Present button (and anything stacked into it, like JumpToTop's
 * flipped copy), so the Read All button can sit beside it rather than under it.
 *
 * The module's default export is a plain component returning an absolute container
 * (`bottom: '100%'`, right side) around the button. The container gets a ref and onLayout
 * through cloneElement and nothing else: JumpToTop reads and replaces `props.children`, so the
 * children have to stay exactly as Discord made them, whichever hook runs first.
 * A plain wrapper, not a patcher `instead` (JumpToTop already has one; two recurse).
 */
export function patchJumpToPresent(): () => void {
	let exports: any
	let original: any
	let wrapper: any
	let active = true

	const install = (mod: any, id: number) => {
		if (wrapper || typeof mod?.default !== 'function') return
		exports = mod
		original = mod.default
		wrapper = function JumpToPresentButtonWithFloater(this: any, ...args: any[]) {
			const el = Reflect.apply(original, this, args)
			if (!active || !React.isValidElement(el)) return el
			try {
				return React.cloneElement(el as any, { ref: track, collapsable: false, onLayout: measure } as any)
			} catch (error) {
				jumpStatus.lastError = `clone: ${(error as Error)?.message ?? error}`
				return el
			}
		}
		mod.default = wrapper
		jumpStatus.hooked = true
		jumpStatus.moduleId = id
	}

	let unsubscribe: (() => void) | undefined
	try {
		unsubscribe = getModuleWithImportedPath(PATH, (mod: any, id: any) => {
			try {
				install(mod, id)
			} catch (error) {
				jumpStatus.lastError = `install: ${(error as Error)?.message ?? error}`
			}
		})
	} catch (error) {
		jumpStatus.lastError = `lookup: ${(error as Error)?.message ?? error}`
	}

	return () => {
		unsubscribe?.()
		// Someone may have wrapped ours since; then it just passes through.
		active = false
		if (exports && exports.default === wrapper) exports.default = original
		track(null)
		jumpStatus.hooked = false
	}
}
