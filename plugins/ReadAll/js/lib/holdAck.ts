/**
 * "Keep chats unread until I tap ✓": stops Discord marking chats read on its own.
 *
 * Every read in ReadStateStore (351.3, `stores/ReadStateStore.tsx`) goes through one method, the
 * ReadState class's `ack(options)`. The automatic ones (opening a chat, reaching the newest
 * messages, coming back to the app, new messages while you're at the bottom) pass only
 * `{ trackAnalytics, location }` or `{ messageId, local: null }`.
 *
 * `isExplicitUserAction` is NOT a person's tap: every `CHANNEL_ACK` gets it from the store's
 * handler, and the chat screen sends plain `ReadStateActionCreators.ack(channelId)` (force false)
 * when it reaches the newest messages. That leaked through 1.5.x. Discord's own "Mark as read"
 * (`ackChannel`) sends `CHANNEL_ACK` with `immediate` and `force` true, so `force` is the real
 * signal. A `BULK_ACK` (this plugin's button, server menu and /readall) and your own sent message
 * pass `local: true`. Only `force` and `local` go through.
 *
 * The class isn't exported, so its prototype comes from any instance:
 * `ReadStateStore.getForDebugging(channelId)` returns one. `ENABLE_/DISABLE_AUTOMATIC_ACK` look
 * like the proper switch but are no-ops on mobile (both handlers just return false).
 *
 * A plain wrapper on the prototype, not a patcher `instead` (two `instead` hooks recurse). The
 * setting is read on every call, so it switches without a reload.
 */

import { Stores } from '@revenge-mod/discord/flux'
import { getData } from '../settings'

export const holdStatus = { hooked: false, lastError: '' }

function sampleReadState(): any {
	const { ReadStateStore, SelectedChannelStore, ChannelStore } = Stores as any
	if (typeof ReadStateStore?.getForDebugging !== 'function') return undefined
	const ids: string[] = []
	const selected = SelectedChannelStore?.getChannelId?.()
	if (selected) ids.push(selected)
	const dms = ChannelStore?.getPrivateChannelIds?.()
	if (dms) ids.push(...(Array.isArray(dms) ? dms : Object.values(dms)).slice(0, 20))
	for (const id of ids) {
		try {
			const state = ReadStateStore.getForDebugging(id)
			if (state && typeof state.ack === 'function') return state
		} catch {}
	}
	return undefined
}

export function patchHoldAck(): () => void {
	let proto: any
	let original: ((this: any, options?: any) => any) | undefined
	let wrapper: typeof original
	let retry: ReturnType<typeof setInterval> | undefined

	const install = () => {
		if (wrapper) return true
		try {
			const state = sampleReadState()
			if (!state) return false
			let target = Object.getPrototypeOf(state)
			// The method may sit further up if Discord ever subclasses it.
			while (target && !Object.prototype.hasOwnProperty.call(target, 'ack')) target = Object.getPrototypeOf(target)
			if (!target || typeof target.ack !== 'function') {
				holdStatus.lastError = 'ReadState has no ack'
				return true
			}
			proto = target
			original = target.ack
			wrapper = function ackUnlessHeld(this: any, options?: any) {
				try {
					if (getData().holdUnread && !options?.force && !options?.local) return false
				} catch {}
				return Reflect.apply(original as any, this, arguments as any)
			}
			target.ack = wrapper
			holdStatus.hooked = true
			return true
		} catch (error) {
			holdStatus.lastError = `install: ${(error as Error)?.message ?? error}`
			return true
		}
	}

	// Read states exist once Discord has connected; until then, look again now and then.
	if (!install()) {
		retry = setInterval(() => {
			if (install() && retry) {
				clearInterval(retry)
				retry = undefined
			}
		}, 1000)
	}

	return () => {
		if (retry) clearInterval(retry)
		if (proto && wrapper && proto.ack === wrapper) proto.ack = original
		holdStatus.hooked = false
	}
}
