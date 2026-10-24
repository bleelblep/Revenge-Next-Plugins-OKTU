import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import { executeClearAll } from './Clear'
import Settings, { bindStorage, DEFAULT_DATA } from './settings'
import { patchChatPill } from './chatPill'
import { patchHoldAck } from './lib/holdAck'
import { patchJumpToPresent } from './lib/jumpToPresent'

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
		description: 'Mark all DMs and group DMs as read',
		async execute() {
			await executeClearAll('dms')
		},
	}
}

export default plugin({
	jsonStorage: {
		default: DEFAULT_DATA,
		load: true,
	},

	init({ jsonStorage }) {
		bindStorage(jsonStorage)
	},

	start({ cleanup }) {
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

		// 2. "Mark read" button above the message box, drawn by the chat input itself
		cleanup(patchChatPill())
		// ...kept clear of Discord's Jump To Present button (and JumpToTop's copy on it)
		cleanup(patchJumpToPresent())

		// 3. Optionally, Discord stops marking chats read by itself (setting read per call)
		cleanup(patchHoldAck())
	},

	SettingsComponent: Settings,
})
