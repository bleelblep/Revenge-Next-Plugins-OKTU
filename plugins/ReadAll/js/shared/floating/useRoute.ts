/**
 * The name of the screen on top, from Discord's root navigation ref, for floating items that
 * belong to one screen only. On 351.3 the server and DM lists are the `guilds` route (inside
 * `main` > `tabs`), an open chat is `channel`, settings are `settings`.
 *
 * The ref isn't ready when the app root mounts, so this keeps looking until it is.
 */

import { lookupModule } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import * as React from 'react'

function navRef(): any {
	try {
		const result: any = lookupModule(withProps('getRootNavigationRef') as any)
		const host = Array.isArray(result) ? result[0] : result
		const ref = (host?.getRootNavigationRef ?? host?.default?.getRootNavigationRef)?.()
		return ref?.isReady?.() === false ? undefined : ref
	} catch {
		return undefined
	}
}

export function useRouteName(): string | undefined {
	const [name, setName] = React.useState<string | undefined>(undefined)

	React.useEffect(() => {
		let unsubscribe: (() => void) | undefined
		let timer: ReturnType<typeof setInterval> | undefined

		const attach = () => {
			const ref = navRef()
			if (!ref?.addListener) return false
			const update = () => setName(ref.getCurrentRoute?.()?.name)
			unsubscribe = ref.addListener('state', update)
			update()
			return true
		}

		if (!attach()) {
			timer = setInterval(() => {
				if (attach() && timer) clearInterval(timer)
			}, 1000)
		}
		return () => {
			if (timer) clearInterval(timer)
			unsubscribe?.()
		}
	}, [])

	return name
}
