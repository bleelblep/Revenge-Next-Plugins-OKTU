/**
 * "Mark as read" in a server icon's long-press menu.
 *
 * Same hook as Mass Delete's "Delete my messages…": the menu's items come from
 * `getGuildsBarGuildMenuItems(guildId)`, each `{ IconComponent, label, action }`. A before-hook
 * keeps the guild id, an after-hook appends our item. Found by path first (349.5+ minifies names).
 * Stock 351.3 has no mark-as-read item here (only notifications, invite and settings).
 */

import * as filters from '@revenge-mod/modules/finders/filters'
import { after, before } from '@revenge-mod/patcher'
import { lookupGeneratedIconComponent } from '@revenge-mod/utils/discord'
import { getModuleByPath } from './shared/modules'
import { showToast } from './shared/toast'
import { executeClearGuild } from './Clear'
import { getData } from './settings'

const PATH = 'modules/guilds_bar/native/utils/getGuildsBarGuildMenuItems.tsx'
const NAME = 'getGuildsBarGuildMenuItems'

function icon() {
	for (const name of ['ChatCheckIcon', 'CheckmarkLargeIcon']) {
		try {
			const component = lookupGeneratedIconComponent(name)
			if (component) return component
		} catch {}
	}
	return undefined
}

export function patchServerMenu(onError: (error: unknown) => void): () => void {
	const patches: Array<() => void> = []
	let guildId: string | undefined

	const stop = getModuleByPath(
		PATH,
		(filters.withName as any)(NAME),
		(mod: any) => {
			const key = typeof mod?.[NAME] === 'function' ? NAME : typeof mod?.default === 'function' ? 'default' : undefined
			if (!key) {
				onError(new Error('the server menu module has no function to hook'))
				return
			}
			patches.push(
				before(mod, key, (args: any[]) => {
					guildId = typeof args[0] === 'string' ? args[0] : args[0]?.guildId ?? args[0]?.id
					return args
				}),
			)
			patches.push(
				after(mod, key, (items: any) => {
					try {
						const id = guildId
						if (!getData().serverMenu || !id || !Array.isArray(items) || items.some(item => item?.key === 'read-all')) return items
						return [
							...items,
							{
								key: 'read-all',
								IconComponent: icon(),
								label: 'Mark as read',
								action: async () => {
									try {
										const { channels } = await executeClearGuild(id)
										showToast(channels ? `Marked ${channels} channels as read` : 'Nothing unread here', 'ReadAllServer')
									} catch (error) {
										onError(error)
										showToast("Couldn't mark this server as read", 'ReadAllServer')
									}
								},
							},
						]
					} catch (error) {
						onError(error)
						return items
					}
				}),
			)
		},
		'[ReadAll+]',
	)

	return () => {
		stop()
		for (const unpatch of patches.splice(0)) {
			try {
				unpatch()
			} catch {}
		}
	}
}
