import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import { findByProps, findByStoreName, toast } from './compat'
import { FieldRow } from './shared/ui/fieldGroup'
import { ReadSquare } from './chatPill'

export interface ReadAllData {
	excludedServers: string[]
	excludedDMs: string[]
	/** The "Mark read" pill above the message box while the open chat is unread. */
	chatPill: boolean
	side: 'left' | 'right'
	/** Just the ✓, no text. */
	compact: boolean
	/** The button's text size, in pt (as Character Counter's). */
	fontSize: number
	/** "Mark as read" in a server icon's long-press menu. */
	serverMenu: boolean
	/** Stop Discord marking chats read by itself (lib/holdAck.ts). */
	holdUnread: boolean
	/** Keep the button up in a read chat too, as "Marked as read", instead of fading it out. */
	alwaysShow: boolean
}

const EMPTY: ReadAllData = {
	excludedServers: [],
	excludedDMs: [],
	chatPill: true,
	side: 'left',
	compact: false,
	fontSize: 12,
	serverMenu: true,
	holdUnread: false,
	// On by default since 1.5.8: a tester expected the button to stay rather than fade.
	alwaysShow: true,
}

export const DEFAULT_DATA = EMPTY

/** Same range and default as Character Counter's text size. */
export const FONT_SIZE = { min: 10, max: 20, default: 12 } as const

/** The button's text size, clamped, from settings stored before there was one too. */
export function fontSizeOf(s: Partial<ReadAllData>): number {
	const size = Number(s.fontSize)
	return Number.isFinite(size) ? Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, Math.round(size))) : FONT_SIZE.default
}

let storage:
	| {
			cache?: Partial<ReadAllData>
			set(value: Partial<ReadAllData>): unknown
			subscribe?(listener: (patch: Partial<ReadAllData>) => void): unknown
	  }
	| undefined

/**
 * The plugin's own copy of its settings. Two jsonStorage handles on one file don't share `cache`
 * (the settings page's `api.jsonStorage` may be another handle than start()'s), so the copy takes
 * this handle's writes and every patch its subscribe reports. Before 1.5.6 a switch could look on
 * in settings while the button and the hold still read the old value.
 */
let mirror: Partial<ReadAllData> = {}

export function bindStorage(s: typeof storage) {
	storage = s
	mirror = { ...(s?.cache ?? {}) }
	try {
		s?.subscribe?.(patch => {
			mirror = { ...mirror, ...(patch ?? {}) }
		})
	} catch {}
}

export function getData(): ReadAllData {
	const cache: Partial<ReadAllData> = { ...(storage?.cache ?? {}), ...mirror }
	return {
		excludedServers: Array.isArray(cache?.excludedServers) ? cache.excludedServers : EMPTY.excludedServers,
		excludedDMs: Array.isArray(cache?.excludedDMs) ? cache.excludedDMs : EMPTY.excludedDMs,
		chatPill: typeof cache?.chatPill === 'boolean' ? cache.chatPill : EMPTY.chatPill,
		side: cache?.side === 'right' ? 'right' : 'left',
		compact: typeof cache?.compact === 'boolean' ? cache.compact : EMPTY.compact,
		fontSize: fontSizeOf(cache ?? {}),
		serverMenu: typeof cache?.serverMenu === 'boolean' ? cache.serverMenu : EMPTY.serverMenu,
		holdUnread: typeof cache?.holdUnread === 'boolean' ? cache.holdUnread : EMPTY.holdUnread,
		alwaysShow: typeof cache?.alwaysShow === 'boolean' ? cache.alwaysShow : EMPTY.alwaysShow,
	}
}

/** Saves a setting; the button picks it up on the chat input's next render. */
export function setData(value: Partial<ReadAllData>) {
	mirror = { ...mirror, ...value }
	void storage?.set(value)
}

export const isServerExcluded = (id: string) => getData().excludedServers.includes(id)
export const isDMExcluded = (id: string) => getData().excludedDMs.includes(id)

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
	const { ScrollView, View } = findByProps('ScrollView')
	const { Slider, Text: DText } = findByProps('TableRowGroup', 'Slider')
	const { TableRowGroup, TableRow, TableSwitchRow, Stack, TextInput } = findByProps(
		'TableRowGroup', 'TableRow', 'TableSwitchRow', 'Stack', 'TextInput',
	)

	const data: ReadAllData = { ...EMPTY, ...(api.jsonStorage.use() ?? getData()) }
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
			setData({ [kind]: [...data[kind], id] })
			setInput('')
			toast('Exception added')
		}
		const remove = (id: string) => {
			setData({ [kind]: data[kind].filter((x: string) => x !== id) })
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
				h(TableRow, { label: 'What is this?', subLabel: 'DMs and group DMs only. In a DM, tap the button above the message box to mark it read, or hold it to mark every DM read. /readall marks every DM read too (skips the IDs below)' })
			),
			
			h(TableRowGroup, { title: 'In chats' },
				h(TableSwitchRow, {
					label: '"Mark read" button',
					subLabel: 'DMs and group DMs only. Tap marks this chat read; hold marks all DMs read after asking',
					value: data.chatPill,
					onValueChange: (v: boolean) => setData({ chatPill: v }),
				}),
				h(TableSwitchRow, {
					label: 'Keep chats unread until I tap ✓',
					subLabel: "Discord stops marking chats read when you open them, scroll to the newest messages or come back to the app, and so does the button. Tapping it, /readall and Discord's own Mark as read still work",
					value: data.holdUnread,
					onValueChange: (v: boolean) => setData({ holdUnread: v }),
				}),
				h(TableSwitchRow, {
					label: 'Always show the button',
					subLabel: 'Stays in every chat: a green "Marked as read" when there is nothing new, a red "✓ Mark as read" when there is',
					value: data.alwaysShow,
					onValueChange: (v: boolean) => setData({ alwaysShow: v }),
				}),
				h(TableSwitchRow, {
					label: 'On the left',
					subLabel: 'Above the +, clear of Jump To Present. Off puts it on the right. Moves up if Character Counter is on the same side',
					value: data.side === 'left',
					onValueChange: (v: boolean) => setData({ side: v ? 'left' : 'right' }),
				}),
				h(TableSwitchRow, {
					label: 'Compact',
					subLabel: 'Just a red ✓, which turns green once read',
					value: data.compact,
					onValueChange: (v: boolean) => setData({ compact: v }),
				}),
			),
			h(TableRowGroup, null,
				h(FieldRow as any, { label: 'Text size' },
					h(View, { style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } },
						h(DText, { color: 'text-muted', variant: 'text-sm/normal' },
							`${fontSizeOf(data)} pt${fontSizeOf(data) === FONT_SIZE.default ? ' (default)' : ''}`,
						),
						h(ReadSquare, { compact: data.compact, fontSize: fontSizeOf(data) }),
					),
					h(Slider, {
						step: 1,
						value: fontSizeOf(data),
						minimumValue: FONT_SIZE.min,
						maximumValue: FONT_SIZE.max,
						onValueChange: (value: number) => setData({ fontSize: Math.round(value) }),
					}),
				),
			),
			...section('excludedDMs', 'Exclude DM / Group', 'Excluded DMs', 'Enter Channel ID', 'Add DM Exception', 'Prevent this channel from being marked as read', dmInput, setDmInput, dmName),
		)
	)
}
