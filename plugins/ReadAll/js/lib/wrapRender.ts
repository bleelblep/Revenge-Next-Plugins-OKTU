import { getModuleWithImportedPath } from '@revenge-mod/discord/utils/modules/finders'

/**
 * Replaces the render function of a component found by its module path: `render` on a
 * `memo(forwardRef(render))` (Discord up to 349), or `type` on a `memo(render)` (350.2 alpha dropped
 * `forwardRef` app-wide, so there is no `render` to find). With a
 * plain function (not a patcher `instead`: two `instead` hooks on one method recurse, upstream
 * bug). Installed when the module loads, or at once if it has. The undo only puts Discord's back
 * if nobody has wrapped ours since.
 */
export function wrapRender(
	path: string,
	status: { hooked: boolean; moduleId: number; lastError: string },
	make: (original: (props: any, ref: any) => any) => (props: any, ref: any) => any,
): () => void {
	let host: any
	let key: 'render' | 'type' = 'render'
	let original: ((props: any, ref: any) => any) | undefined
	let wrapper: ((props: any, ref: any) => any) | undefined

	const install = (exports: any, id: number) => {
		if (wrapper) return
		// Step through memo's `type` to the forwardRef object that holds `render`.
		const memo = exports?.default ?? exports
		let target = memo
		for (let i = 0; i < 3 && target && typeof target.render !== 'function'; i++) target = target.type
		if (typeof target?.render === 'function') {
			host = target
			key = 'render'
		} else if (typeof memo?.type === 'function') {
			// 350.2: memo(render), no forwardRef in between.
			host = memo
			key = 'type'
		} else {
			status.lastError = `module ${id} has no render`
			return
		}
		original = host[key]
		wrapper = make(original as (props: any, ref: any) => any)
		host[key] = wrapper
		status.hooked = true
		status.moduleId = id
	}

	let unsubscribe: (() => void) | undefined
	try {
		unsubscribe = getModuleWithImportedPath(path, (exports: any, id: any) => {
			try {
				install(exports, id)
			} catch (error) {
				status.lastError = `install: ${(error as Error)?.message ?? error}`
			}
		})
	} catch (error) {
		status.lastError = `lookup: ${(error as Error)?.message ?? error}`
	}

	return () => {
		unsubscribe?.()
		if (host && wrapper && host[key] === wrapper) host[key] = original
		status.hooked = false
	}
}
