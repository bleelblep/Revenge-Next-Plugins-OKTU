/**
 * "Mark read" button floating just above the message box in a DM or group DM. Tap: this chat.
 * Hold: every DM, after a confirmation. DMs only since 1.6.0 (1.6.1 dropped the server menu too).
 *
 * Placed and drawn like Character Counter's square: appended to the chat input's own container
 * (`modules/chat_input/native/ChatInput.tsx`) and absolutely placed from its top edge
 * (`bottom: '100%'`). Discord does the same with its Jump To Present button
 * (`components_native/chat/JumpToPresentButton.tsx`: absolute, `bottom: '100%'`,
 * `pointerEvents: 'box-none'`), and taps on that land, so the button needs no app-wide layer.
 *
 * It keeps out of the way of Discord's "…is typing" line (seen in the chat input's tree, as
 * Character Counter does) and of other floaters that report themselves through
 * shared/chatFloaters.tsx (Character Counter's square): it measures where it would sit without
 * moving, and lifts itself above whatever is there. Discord's Jump To Present button (and
 * JumpToTop's copy on it, lib/jumpToPresent.ts) it sits beside instead, to its left.
 *
 * Discord marks the open chat read by itself once you reach the newest messages, so the button
 * often goes without a tap. Either way it doesn't just vanish: it turns from a red "✓ Mark as read"
 * into a green "Marked as read", which slowly fades out. Another chat hides it at once.
 */

import { Design } from '@revenge-mod/discord/design'
import { Stores } from '@revenge-mod/discord/flux'
import * as commonTokens from '@revenge-mod/discord/common/tokens'
import * as React from 'react'
import * as ReactNative from 'react-native'
import { clearOf, reportFloater, useFloaters } from './shared/chatFloaters'
import { showToast } from './shared/toast'
import { confirmDestructive } from './shared/ui/confirm'
import { executeClearAll, hasUnreadChannel, isPrivateChannel, markChannelRead, unreadDMCount } from './Clear'
import { fontSizeOf, getData } from './settings'
import { jumpStatus, useJumpToPresentRect } from './lib/jumpToPresent'
import { wrapRender } from './lib/wrapRender'

const PATH = 'modules/chat_input/native/ChatInput.tsx'
const GAP = 8
/** Roughly the "…is typing" line's height (same as Character Counter's). */
const TYPING_LINE = 26
/** Above Character Counter's 0: the button is the one that moves. */
const PRIORITY = 10
const ID = 'read-all'

export const anchorStatus = { hooked: false, moduleId: -1, lastError: '', placed: false }

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

/** A colour by token name through the theme in use (as Character Counter's badge.tsx). */
function token(name: string, fallback: string): string {
	try {
		const tables = (commonTokens as any)?.Tokens
		const store = (Stores as any).ThemeStore
		const theme = store?.theme ?? 'darker'
		const semantic = tables?.SemanticColor?.[name]
		const entry = semantic?.[theme] ?? semantic?.darker ?? semantic?.dark
		const raw = entry?.raw ? tables?.RawColor?.[entry.raw] : undefined
		return typeof raw === 'string' ? raw : fallback
	} catch {
		return fallback
	}
}

interface OpenChat {
	selected?: string
	/** The selected chat's id while it has unread messages. */
	unread?: string
}

/** The open chat and whether it has unread messages, kept up to date. */
function useOpenChat(): OpenChat {
	const read = (): OpenChat => {
		const { SelectedChannelStore } = Stores as any
		const open: string | undefined = SelectedChannelStore?.getChannelId?.()
		// DMs and group DMs only (1.6.0): in a server channel the button is never shown.
		const id = open && isPrivateChannel(open) ? open : undefined
		return { selected: id, unread: id && hasUnreadChannel(id) ? id : undefined }
	}
	const [chat, setChat] = React.useState<OpenChat>(read)
	React.useEffect(() => {
		const { ReadStateStore, SelectedChannelStore } = Stores as any
		const stores = [ReadStateStore, SelectedChannelStore].filter(s => s?.addChangeListener)
		let timer: ReturnType<typeof setTimeout> | undefined
		const update = () => {
			if (timer) return
			timer = setTimeout(() => {
				timer = undefined
				const next = read()
				setChat(prev => (prev.selected === next.selected && prev.unread === next.unread ? prev : next))
			}, 200)
		}
		for (const store of stores) store.addChangeListener(update)
		update()
		return () => {
			if (timer) clearTimeout(timer)
			for (const store of stores) store.removeChangeListener(update)
		}
	}, [])
	return chat
}

/** How long "Marked as read" stays fully visible, then how long it takes to fade (ms). */
const DONE_HOLD = 1200
const DONE_FADE = 1500
/**
 * How long the chat has to sit at the newest message before the button marks it read (ms). Long
 * enough to scroll past the bottom, and for the jump button to report itself on opening a chat.
 */
const AT_BOTTOM_DELAY = 1000

/**
 * The button's face: Character Counter's square. Shared with the settings preview.
 * Red "✓ Mark as read" while unread; `done` makes it a green "Marked as read".
 */
export function ReadSquare({
	compact,
	pressed = false,
	done = false,
	fontSize,
}: { compact: boolean; pressed?: boolean; done?: boolean; fontSize: number }) {
	const { View } = ReactNative
	const { Text } = Design as any
	const lineHeight = Math.round(fontSize * 1.34)
	return (
		<View
			style={{
				minWidth: 32,
				minHeight: lineHeight + 12,
				paddingHorizontal: 8,
				paddingVertical: 4,
				borderRadius: 8,
				alignItems: 'center',
				justifyContent: 'center',
				backgroundColor: token('MOBILE_CHATINPUT_BACKGROUND_DEFAULT', '#222327'),
				// No shadow once read: Android leaves an elevation shadow behind while it fades.
				elevation: done ? 0 : 4,
				opacity: pressed ? 0.7 : 1,
			}}
		>
			<Text
				variant="text-xs/semibold"
				lineClamp={1}
				style={{
					fontSize,
					lineHeight,
					color: done ? token('TEXT_FEEDBACK_POSITIVE', '#23A55A') : token('TEXT_FEEDBACK_CRITICAL', '#F23F43'),
				}}
			>
				{done ? (compact ? '✓' : 'Marked as read') : compact ? '✓' : '✓ Mark as read'}
			</Text>
		</View>
	)
}

/** Holding the button: asks first, then marks every DM and group DM read (exclusions apply). */
function confirmAllDMs() {
	const count = unreadDMCount()
	if (count === 0) {
		showToast('No unread DMs', 'ReadAllDMs')
		return
	}
	confirmDestructive({
		title: 'Mark all DMs as read?',
		body: `${count} unread ${count === 1 ? 'DM' : 'DMs'} and group DMs will be marked as read. Excluded DMs are left alone.`,
		action: 'Mark all as read',
		onConfirm() {
			executeClearAll('dms').then(
				result => showToast(`Marked ${result.dms} ${result.dms === 1 ? 'DM' : 'DMs'} as read`, 'ReadAllDMs'),
				() => showToast("Couldn't mark DMs as read", 'ReadAllDMs'),
			)
		},
	})
}

function ReadButton({ typing }: { typing: boolean }) {
	const { Animated, Pressable } = ReactNative
	const { selected, unread } = useOpenChat()
	// The chat the button is showing for: stays set while it fades out after being read.
	const [channelId, setChannelId] = React.useState<string | undefined>(unread)
	const [done, setDone] = React.useState(false)
	const fade = React.useRef(new Animated.Value(1)).current
	const obstacles = useFloaters(ID, PRIORITY)
	const ref = React.useRef<any>(null)
	const jump = useJumpToPresentRect()
	const [lift, setLift] = React.useState(0)
	// How far it steps left to sit beside the jump buttons (right side only).
	const [shift, setShift] = React.useState(0)
	// Where it sits without the lift, in window coordinates; measured, since JS can't know
	// where the chat input is on screen otherwise.
	const [home, setHome] = React.useState<{ x: number; y: number; width: number; height: number }>()
	const liftRef = React.useRef(0)
	liftRef.current = lift
	const shiftRef = React.useRef(0)
	shiftRef.current = shift

	const measure = React.useCallback(() => {
		try {
			ref.current?.measureInWindow?.((x: number, y: number, width: number, height: number) => {
				if (!(width > 0 && height > 0)) return
				const rect = { x, y, width, height }
				reportFloater(ID, rect, PRIORITY)
				const base = { ...rect, x: x + shiftRef.current, y: y + liftRef.current }
				setHome(prev =>
					prev && prev.x === base.x && prev.y === base.y && prev.width === width && prev.height === height ? prev : base,
				)
			})
		} catch {}
	}, [])

	// "Always show the button": stays as "Marked as read" in a read chat instead of fading.
	const always = getData().alwaysShow
	const alwaysRef = React.useRef(always)
	alwaysRef.current = always

	// Read (by the tap, or by Discord once you reach the newest messages): confirm, then fade slowly.
	const finish = React.useCallback(() => {
		setDone(true)
		if (alwaysRef.current) return
		Animated.timing(fade, { toValue: 0, delay: DONE_HOLD, duration: DONE_FADE, useNativeDriver: true }).start(
			({ finished }: { finished: boolean }) => {
				if (!finished) return
				setChannelId(undefined)
				setDone(false)
			},
		)
	}, [])

	React.useEffect(() => {
		if (unread) {
			// Unread (again): back to "Mark as read", cancelling a fade on the way out.
			fade.stopAnimation()
			fade.setValue(1)
			setDone(false)
			setChannelId(unread)
		} else if (always && selected) {
			// Nothing unread, but always shown: "Marked as read" for whichever chat is open.
			fade.stopAnimation()
			fade.setValue(1)
			setDone(true)
			setChannelId(selected)
		} else if (channelId && channelId === selected) {
			// Read while open; also when "Always show" was just turned off.
			if (!done || !always) finish()
		} else if (channelId) {
			// Another chat: that one has its own state.
			fade.stopAnimation()
			setDone(false)
			setChannelId(undefined)
		}
	}, [selected, unread, always])

	// At the newest message, Discord can leave the chat unread for a while (its "N new messages"
	// bar stays up), so the button said "Mark as read" with nothing left to read. Discord's Jump To
	// Present button is only there while scrolled up, so its absence means the bottom: mark the
	// chat read for real then, so Discord agrees. Not when the user holds chats unread, and only
	// while that button is hooked (otherwise its absence says nothing).
	const atBottom = jumpStatus.hooked && !jump
	React.useEffect(() => {
		if (!unread || !atBottom || getData().holdUnread) return
		const timer = setTimeout(() => {
			if (markChannelRead(unread)) finish()
		}, AT_BOTTOM_DELAY)
		return () => clearTimeout(timer)
	}, [unread, atBottom])

	// The button moves with the keyboard without re-laying out, so it also checks now and then.
	React.useEffect(() => {
		if (!channelId) return
		const poll = setInterval(measure, 500)
		return () => {
			clearInterval(poll)
			reportFloater(ID, undefined)
		}
	}, [channelId])

	React.useEffect(() => {
		if (!home) return
		// Beside the jump buttons when they share its spot...
		let nextShift = 0
		if (jump && home.x < jump.x + jump.width + GAP && jump.x < home.x + home.width + GAP) {
			nextShift = Math.max(0, Math.round(home.x + home.width + GAP - jump.x))
		}
		// ...then above anything else (Character Counter's square).
		const beside = { ...home, x: home.x - nextShift }
		const spot = clearOf(beside, obstacles)
		const nextLift = Math.max(0, Math.round(home.y - spot.y))
		if (nextShift !== shift) setShift(nextShift)
		if (nextLift !== lift) setLift(nextLift)
	})

	if (!channelId) return null
	const data = getData()
	const side = data.side === 'right' ? { right: 16 + shift } : { left: 16 }

	return (
		<Animated.View
			ref={ref}
			collapsable={false}
			onLayout={measure}
			// Still holdable while it stays up as "Marked as read" (other DMs may be unread).
			pointerEvents={done && !always ? 'none' : 'box-none'}
			// Fade it as one picture: otherwise Android fades the background and the text one by one.
			needsOffscreenAlphaCompositing
			renderToHardwareTextureAndroid={done}
			style={{
				position: 'absolute',
				bottom: '100%',
				marginBottom: GAP + (typing ? TYPING_LINE : 0) + lift,
				...side,
				opacity: fade,
			}}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={done ? 'This chat is marked as read' : 'Mark this chat as read'}
				accessibilityHint="Hold to mark all DMs as read"
				onPress={() => {
					if (done) return
					if (markChannelRead(channelId)) finish()
					else showToast("Couldn't mark this chat as read", 'ReadAllChat')
				}}
				onLongPress={confirmAllDMs}
			>
				{({ pressed }: { pressed: boolean }) => (
					<ReadSquare compact={data.compact} pressed={pressed} done={done} fontSize={fontSizeOf(data)} />
				)}
			</Pressable>
		</Animated.View>
	)
}

/** Puts the button into every chat input. Returns the undo. */
export function patchChatPill(): () => void {
	return wrapRender(PATH, anchorStatus, original =>
		function ChatInputWithReadAll(props: any, ref: any) {
			const tree = original(props, ref)
			try {
				if (!getData().chatPill) return tree
				const container = find(tree, isContainer)
				if (container && !container.props.children.some((child: any) => child?.key === 'read-all')) {
					const typing = container.props.children.some((child: any) => isTypingFill(child))
					container.props.children = [...container.props.children, <ReadButton key="read-all" typing={typing} />]
					anchorStatus.placed = true
				}
			} catch (error) {
				anchorStatus.lastError = `place: ${(error as Error)?.message ?? error}`
			}
			return tree
		},
	)
}
