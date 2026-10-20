/**
 * "Mark read" pill floating just above the message box while the open chat has unread messages.
 *
 * Placed like Character Counter's square (above the box, left or right) but drawn on the app-wide
 * floating layer (shared/floating/host.tsx), not inside the chat input: Android doesn't deliver
 * taps to a child drawn outside its parent's bounds, and "above the box" is outside them.
 *
 * To line it up, the chat input (`modules/chat_input/native/ChatInput.tsx`) gets an invisible
 * marker filling its container. The marker measures itself in window coordinates whenever its
 * size changes, the keyboard moves, and every 700 ms while mounted (a parent moving doesn't
 * re-layout the marker), and the pill sits on top of that rectangle.
 *
 * It then keeps out of the way of anything else floating there: Discord's "…is typing" line
 * (seen in the chat input's tree, as Character Counter does) and other plugins' floaters that
 * report themselves through shared/chatFloaters.tsx (Character Counter's square).
 */

import { Stores } from '@revenge-mod/discord/flux'
import * as React from 'react'
import * as ReactNative from 'react-native'
import { useRouteName } from './shared/floating/useRoute'
import { clearOf, FloaterProbe, useFloaters } from './shared/chatFloaters'
import { showToast } from './shared/toast'
import { hasUnreadChannel, markChannelRead } from './Clear'
import { getData } from './settings'
import { wrapRender } from './lib/wrapRender'

const PATH = 'modules/chat_input/native/ChatInput.tsx'
const GAP = 8
/** Roughly the "…is typing" line's height (same as Character Counter's). */
const TYPING_LINE = 26
/** Above Character Counter's 0: the pill is the one that moves. */
const PRIORITY = 10

// Tweak these to match your theme.
const PILL_BG = '#1B2625'
const PILL_BORDER = '#2F3D3B'
const ICON_COLOR = '#6FD3CB'
const TEXT_COLOR = '#E8EAEA'

export const anchorStatus = { hooked: false, moduleId: -1, lastError: '', placed: false }

interface Rect {
	x: number
	y: number
	width: number
	height: number
}

// --- Where the chat input is on screen ---------------------------------------------------------

let anchor: { owner: number; rect: Rect; typing: boolean } | undefined
const anchorListeners = new Set<() => void>()
let nextOwner = 1

function setAnchor(owner: number, rect: Rect | undefined, typing = false) {
	const prev = anchor
	if (rect) {
		if (prev && prev.owner === owner && prev.typing === typing && sameRect(prev.rect, rect)) return
		anchor = { owner, rect, typing }
	} else {
		if (prev?.owner !== owner) return
		anchor = undefined
	}
	for (const listener of anchorListeners) listener()
}

function sameRect(a: Rect, b: Rect) {
	return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function useAnchor(): { rect: Rect; typing: boolean } | undefined {
	const [, setTick] = React.useState(0)
	React.useEffect(() => {
		const listener = () => setTick(n => n + 1)
		anchorListeners.add(listener)
		return () => {
			anchorListeners.delete(listener)
		}
	}, [])
	return anchor
}

/** Invisible, fills the chat input's container, reports where that is. */
function Marker({ typing }: { typing: boolean }) {
	const { View, Keyboard, StyleSheet } = ReactNative
	const ref = React.useRef<any>(null)
	const owner = React.useRef(0)
	if (!owner.current) owner.current = nextOwner++

	const typingRef = React.useRef(typing)
	typingRef.current = typing

	const measure = React.useCallback(() => {
		try {
			ref.current?.measureInWindow?.((x: number, y: number, width: number, height: number) => {
				if (width > 0 && height > 0) setAnchor(owner.current, { x, y, width, height }, typingRef.current)
			})
		} catch {}
	}, [])

	// The typing line comes and goes without the container changing size.
	React.useEffect(measure, [typing])

	React.useEffect(() => {
		const later = () => {
			measure()
			setTimeout(measure, 120)
			setTimeout(measure, 350)
		}
		const show = Keyboard.addListener('keyboardDidShow', later)
		const hide = Keyboard.addListener('keyboardDidHide', later)
		const poll = setInterval(measure, 700)
		return () => {
			show.remove()
			hide.remove()
			clearInterval(poll)
			setAnchor(owner.current, undefined)
		}
	}, [])

	return <View ref={ref} pointerEvents="none" collapsable={false} onLayout={measure} style={StyleSheet.absoluteFill} />
}

function flatten(style: unknown): Record<string, any> {
	try {
		return ReactNative.StyleSheet.flatten(style as any) ?? {}
	} catch {
		return {}
	}
}

/** Discord's solid fill behind the "…is typing" line (as Character Counter's badge.tsx). */
function isTypingFill(node: any): boolean {
	const props = node?.props
	if (!props || props.pointerEvents !== 'none' || props.children != null || !props.style) return false
	const style = flatten(props.style)
	return style.position === 'absolute' && style.top === 0 && style.bottom === 0 && style.backgroundColor != null
}

function isContainer(node: any): boolean {
	const props = node?.props
	return !!props && props.collapsable === false && typeof props.onLayout === 'function' && Array.isArray(props.children)
}

function find(root: any, predicate: (node: any) => boolean, depth = 0): any {
	if (!root || typeof root !== 'object' || depth > 25) return undefined
	if (!Array.isArray(root) && predicate(root)) return root
	const children = Array.isArray(root) ? root : root.props?.children
	if (Array.isArray(children)) {
		for (const child of children) {
			const found = find(child, predicate, depth + 1)
			if (found) return found
		}
	} else if (children && typeof children === 'object') {
		return find(children, predicate, depth + 1)
	}
	return undefined
}

/** Puts the marker into every chat input. Returns the undo. */
export function patchChatAnchor(): () => void {
	return wrapRender(PATH, anchorStatus, original =>
		function ChatInputWithReadAllMarker(props: any, ref: any) {
			const tree = original(props, ref)
			try {
				const container = find(tree, isContainer)
				if (container && !container.props.children.some((child: any) => child?.key === 'read-all-marker')) {
					const typing = container.props.children.some((child: any) => isTypingFill(child))
					container.props.children = [...container.props.children, <Marker key="read-all-marker" typing={typing} />]
					anchorStatus.placed = true
				}
			} catch (error) {
				anchorStatus.lastError = `place: ${(error as Error)?.message ?? error}`
			}
			return tree
		},
	)
}

// --- The pill ----------------------------------------------------------------------------------

/** The open chat's id and whether it has unread messages, kept up to date. */
function useOpenChatUnread(): string | undefined {
	const read = () => {
		const { SelectedChannelStore } = Stores as any
		const id: string | undefined = SelectedChannelStore?.getChannelId?.()
		return id && hasUnreadChannel(id) ? id : undefined
	}
	const [channelId, setChannelId] = React.useState<string | undefined>(read)
	React.useEffect(() => {
		const { ReadStateStore, SelectedChannelStore } = Stores as any
		const stores = [ReadStateStore, SelectedChannelStore].filter(s => s?.addChangeListener)
		let timer: ReturnType<typeof setTimeout> | undefined
		const update = () => {
			if (timer) return
			timer = setTimeout(() => {
				timer = undefined
				setChannelId(read())
			}, 200)
		}
		for (const store of stores) store.addChangeListener(update)
		update()
		return () => {
			if (timer) clearTimeout(timer)
			for (const store of stores) store.removeChangeListener(update)
		}
	}, [])
	return channelId
}

export function ChatPill() {
	const { Pressable, Text, View, useWindowDimensions } = ReactNative
	const window = useWindowDimensions()
	const route = useRouteName()
	const placed = useAnchor()
	const channelId = useOpenChatUnread()
	const obstacles = useFloaters('read-all', PRIORITY)
	const [size, setSize] = React.useState<{ width: number; height: number } | undefined>(undefined)
	const data = getData()

	if (route !== 'channel' || !placed || !channelId) return null

	// Where it would like to be: above the box, on its side, over the typing line if it's showing.
	const { rect, typing } = placed
	const width = size?.width ?? 0
	const height = size?.height ?? 0
	const wanted = {
		x: data.side === 'left' ? rect.x + 16 : rect.x + rect.width - 16 - width,
		y: rect.y - GAP - height - (typing ? TYPING_LINE : 0),
		width,
		height,
	}
	// Then up and out of the way of anything else there.
	const spot = size ? clearOf(wanted, obstacles) : wanted
	const pill = data.compact ? 32 : 30

	return (
		<View
			onLayout={(e: any) => {
				const { width: w, height: h } = e.nativeEvent.layout
				if (w !== size?.width || h !== size?.height) setSize({ width: w, height: h })
			}}
			// Hidden until measured, so it never flashes in the wrong place.
			// From the bottom, as 1.3.0 did (lined up on device): the layer's top can sit below the status bar.
			style={{ position: 'absolute', left: spot.x, bottom: window.height - (spot.y + height), opacity: size ? 1 : 0 }}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Mark this chat as read"
				onPress={() => {
					if (!markChannelRead(channelId)) showToast("Couldn't mark this chat as read", 'ReadAllChat')
				}}
				style={({ pressed }: { pressed: boolean }) => ({
					minWidth: pill,
					height: pill,
					borderRadius: pill / 2,
					paddingHorizontal: data.compact ? 0 : 12,
					flexDirection: 'row',
					alignItems: 'center',
					justifyContent: 'center',
					backgroundColor: PILL_BG,
					borderWidth: 1,
					borderColor: PILL_BORDER,
					elevation: 4,
					opacity: pressed ? 0.7 : 1,
				})}
			>
				<Text style={{ color: ICON_COLOR, fontSize: 15, fontWeight: '700' }}>✓</Text>
				{!data.compact && <Text style={{ color: TEXT_COLOR, fontSize: 13, fontWeight: '700', marginLeft: 6 }}>Mark read</Text>}
			</Pressable>
			{size && <FloaterProbe id="read-all" priority={PRIORITY} />}
		</View>
	)
}
