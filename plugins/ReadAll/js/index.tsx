import React from 'react'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import { executeClearAll } from './Clear'
import Settings, { bindStorage, DEFAULT_DATA, getData } from './settings'
import { ChatPill, patchChatAnchor } from './chatPill'
import { patchServerMenu } from './serverMenu'
import { addFloating, installFloatingRoot, onFloatingError, watchFloatingRoot } from './shared/floating/host'

interface CommandOption {
	name: string
	description: string
	type: number
	required?: boolean
	choices?: { name: string; value: string }[]
}

interface Command {
	id?: string
	name: string
	description: string
	options?: CommandOption[]
	execute: (args: any[], ctx: any) => void | Promise<void>
}

function nextCommandId(res: any[]): string {
	const used = new Set(res.map((c: any) => c?.id).filter(Boolean))
	let n = 1
	while (used.has(String(n))) n++
	return String(n)
}

function buildCommand(): Command {
	return {
		name: 'readall',
		description: 'Mark all servers and DMs as read',
		async execute() {
			await executeClearAll()
		},
	}
}

export default plugin({
	jsonStorage: {
		default: DEFAULT_DATA,
		load: true,
	},

	preInit({ cleanup, plugin }) {
		// The app's root wrapper is read once at startup, so the floating layer has to be set up
		// before then. Enabled later, it waits for a reload.
		if (!plugin.startedLate) watchFloatingRoot(cleanup)
	},

	init({ jsonStorage }) {
		bindStorage(jsonStorage)
	},

	start({ cleanup, plugin }) {
		let command: Command | undefined

		// 1. Slash Command Patch
		cleanup(
			getModules(withProps('getBuiltInCommands'), store => {
				cleanup(
					after(store as any, 'getBuiltInCommands', (res: any) => {
						if (!Array.isArray(res)) return res
						const cmd = (command ??= buildCommand())
						cmd.id ??= nextCommandId(res)
						if (res.some((c: any) => c?.id === cmd.id)) return res
						return [...res, cmd]
					}),
				)
			}),
		)

		const report = (error: unknown) => plugin.reportError?.(error)

		// 2. "Mark as read" in the server long-press menu (no reload needed)
		cleanup(patchServerMenu(report))

		// 3. "Mark read" pill above the message box, drawn on the app-wide floating layer
		//    (shared/floating), which can only be added at startup.
		cleanup(patchChatAnchor())
		if (plugin.startedLate) {
			plugin.requireReload()
		} else {
			try {
				onFloatingError((context, error) => report(new Error(`${context}: ${(error as Error)?.message ?? error}`)))
				cleanup(installFloatingRoot())
				cleanup(addFloating('read-all-chat', () => (getData().chatPill ? React.createElement(ChatPill) : null)))
			} catch (error) {
				report(error)
			}
		}
	},

	stop({ plugin }) {
		// The root wrapper only goes away cleanly on a reload.
		plugin.requireReload()
	},

	SettingsComponent: Settings,
})
