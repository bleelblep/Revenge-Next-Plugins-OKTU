import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import { findByProps, findByStoreName, toast } from './compat'
import { refreshFloating } from './shared/floating/host'

export interface ReadAllData {
	excludedServers: string[]
	excludedDMs: string[]
	/** The "Mark read" pill above the message box while the open chat is unread. */
	chatPill: boolean
	side: 'left' | 'right'
	/** A small round ✓ instead of the "Mark read" pill. */
	compact: boolean
	/** "Mark as read" in a server icon's long-press menu. */
	serverMenu: boolean
}

const EMPTY: ReadAllData = {
	excludedServers: [],
	excludedDMs: [],
	chatPill: true,
	side: 'right',
	compact: false,
	serverMenu: true,
}

export const DEFAULT_DATA = EMPTY

let storage:
	| {
			cache?: Partial<ReadAllData>
			set(value: Partial<ReadAllData>): unknown
	  }
	| undefined

export function bindStorage(s: typeof storage) {
	storage = s
}

export function getData(): ReadAllData {
	const cache = storage?.cache
	return {
		excludedServers: Array.isArray(cache?.excludedServers) ? cache.excludedServers : EMPTY.excludedServers,
		excludedDMs: Array.isArray(cache?.excludedDMs) ? cache.excludedDMs : EMPTY.excludedDMs,
		chatPill: typeof cache?.chatPill === 'boolean' ? cache.chatPill : EMPTY.chatPill,
		side: cache?.side === 'left' ? 'left' : 'right',
		compact: typeof cache?.compact === 'boolean' ? cache.compact : EMPTY.compact,
		serverMenu: typeof cache?.serverMenu === 'boolean' ? cache.serverMenu : EMPTY.serverMenu,
	}
}

/** Saves a setting and redraws the pill with it. */
export function setData(value: Partial<ReadAllData>) {
	const done = storage?.set(value)
	Promise.resolve(done).finally(refreshFloating)
	refreshFloating()
}

export const isServerExcluded = (id: string) => getData().excludedServers.includes(id)
export const isDMExcluded = (id: string) => getData().excludedDMs.includes(id)

const serverName = (id: string) => {
	try {
		const guild = findByStoreName('GuildStore')?.getGuild?.(id)
		return guild?.name ? `${guild.name} (${id})` : id
	} catch { return id }
}

const dmName = (id: string) => {
	try {
		const channel = findByStoreName('ChannelStore')?.getChannel?.(id)
		if (channel?.name) return `${channel.name} (${id})`
		const first = channel?.recipients?.[0]
		if (first) {
			const user = findByStoreName('UserStore')?.getUser?.(first)
			return user?.username ? `@${user.username} (${id})` : id
		}
	} catch {}
	return id
}

export default function Settings({ api }: { api: any }) {
	const h = React.createElement
	const { ScrollView } = findByProps('ScrollView')
	const { TableRowGroup, TableRow, TableSwitchRow, Stack, TextInput } = findByProps(
		'TableRowGroup', 'TableRow', 'TableSwitchRow', 'Stack', 'TextInput',
	)

	const data: ReadAllData = { ...EMPTY, ...(api.jsonStorage.use() ?? getData()) }
	const [serverInput, setServerInput] = React.useState('')
	const [dmInput, setDmInput] = React.useState('')

	const section = (
		kind: 'excludedServers' | 'excludedDMs',
		title: string, listTitle: string, placeholder: string, addLabel: string, addSub: string,
		input: string, setInput: (v: string) => void, nameOf: (id: string) => string,
	) => {
		const add = () => {
			const id = input.trim()
			if (!id) return toast('Please enter an ID')
			if (data[kind].includes(id)) return toast('Already excluded')
			void api.jsonStorage.set({ [kind]: [...data[kind], id] })
			setInput('')
			toast('Exception added')
		}
		const remove = (id: string) => {
			void api.jsonStorage.set({ [kind]: data[kind].filter((x: string) => x !== id) })
			toast('Exception removed')
		}

		return [
			h(TableRowGroup, { key: `${kind}-in`, title },
				h(Stack, { spacing: 4 },
					h(TextInput, { placeholder, value: input, onChange: setInput, isClearable: true, onSubmitEditing: add, returnKeyType: 'done' })
				)
			),
			h(TableRowGroup, { key: `${kind}-add` },
				h(TableRow, { label: addLabel, subLabel: addSub, trailing: h(TableRow.Arrow), onPress: add })
			),
			data[kind].length > 0 && h(TableRowGroup, { key: `${kind}-list`, title: listTitle },
				data[kind].map((id: string) =>
					h(TableRow, {
						key: id, label: nameOf(id),
						trailing: h(TouchableOpacity, { onPress: () => remove(id) },
							h(Text, { style: { color: '#ff4d4d', fontSize: 18 } }, '✕')
						),
					})
				),
			),
		]
	}

	return h(ScrollView, { style: { flex: 1 }, contentContainerStyle: { padding: 10 } },
		h(Stack, { spacing: 8 },
			h(TableRowGroup, { title: 'Read All+ Info' },
				h(TableRow, { label: 'What is this?', subLabel: 'Mark a chat read from the pill above the message box, a server from its long-press menu, or everything with /readall (skips the IDs below)' })
			),
			
			h(TableRowGroup, { title: 'In chats' },
				h(TableSwitchRow, {
					label: '"Mark read" pill',
					subLabel: 'Floats above the message box while the open DM or channel has unread messages. Turning it on needs a reload.',
					value: data.chatPill,
					onValueChange: (v: boolean) => setData({ chatPill: v }),
				}),
				h(TableSwitchRow, {
					label: 'On the left',
					subLabel: 'Off puts it on the right (Character Counter sits on the left by default)',
					value: data.side === 'left',
					onValueChange: (v: boolean) => setData({ side: v ? 'left' : 'right' }),
				}),
				h(TableSwitchRow, {
					label: 'Compact',
					subLabel: 'Just a round ✓',
					value: data.compact,
					onValueChange: (v: boolean) => setData({ compact: v }),
				}),
			),
			h(TableRowGroup, { title: 'Servers' },
				h(TableSwitchRow, {
					label: 'Mark as read in the server menu',
					subLabel: 'Long-press a server icon to mark just that server read',
					value: data.serverMenu,
					onValueChange: (v: boolean) => setData({ serverMenu: v }),
				}),
			),

			...section('excludedServers', 'Exclude Server', 'Excluded Servers', 'Enter Server ID', 'Add Server Exception', 'Prevent this server from being marked as read', serverInput, setServerInput, serverName),
			...section('excludedDMs', 'Exclude DM / Group', 'Excluded DMs', 'Enter Channel ID', 'Add DM Exception', 'Prevent this channel from being marked as read', dmInput, setDmInput, dmName),
		)
	)
}
