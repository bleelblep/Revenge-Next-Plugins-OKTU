import * as flux from '@revenge-mod/discord/common/flux'
import { Stores } from '@revenge-mod/discord/flux'
import { getData } from './settings'

export interface ClearAllResult {
	dms: number
	channels: number
	skipped: number
}

/** Stores often return `{ [id]: value }` maps instead of arrays. Accept both. */
function toArray<T = any>(value: unknown): T[] {
	if (!value) return []
	return Array.isArray(value) ? value : (Object.values(value) as T[])
}

function guildIdsOf(GuildStore: any): string[] {
	return toArray<any>(GuildStore?.getGuildIds?.() ?? Object.keys(GuildStore?.getGuilds?.() ?? {}))
}

/**
 * Whether there's anything for the button to do: an unread DM, or a server Discord shows as
 * unread (GuildReadStateStore already leaves out muted servers and channels). Cheap enough to
 * run on every read-state change, unlike walking every channel.
 */
export function hasAnythingUnread(): boolean {
	try {
		const { excludedServers, excludedDMs } = getData()
		const { ReadStateStore, GuildReadStateStore, ChannelStore, GuildStore } = Stores as any
		for (const id of toArray<string>(ChannelStore?.getPrivateChannelIds?.())) {
			if (!excludedDMs.includes(id) && ReadStateStore?.hasUnread?.(id)) return true
		}
		for (const id of guildIdsOf(GuildStore)) {
			if (!excludedServers.includes(id) && GuildReadStateStore?.hasUnread?.(id)) return true
		}
	} catch {
		return true
	}
	return false
}

/** How many channels go in one BULK_ACK (the ack-bulk endpoint takes 100 at a time). */
const CHUNK = 100

/**
 * Marks every unread DM and every unread channel (and joined thread) in non-excluded servers as
 * read, in one go, the way Discord's own "Mark as read" does: a `BULK_ACK` Flux action with
 * `{ channelId, messageId, readStateType: 0 }` per channel, which ReadStateStore applies locally
 * and sends to `/read-states/ack-bulk`. Same as `ReadStateActionCreators.bulkAck` on 351.3.
 *
 * Stores come from Revenge's `Stores` proxy: `withName('ReadStateStore')` matches nothing (a store
 * is an instance, not a named function), which is why the old version always found "nothing".
 */
export type ClearKind = 'all' | 'servers' | 'dms'

export async function executeClearAll(kind: ClearKind = 'all', onlyGuild?: string): Promise<ClearAllResult> {
	const { excludedServers, excludedDMs } = getData()
	const excludedS = new Set(excludedServers)
	const excludedD = new Set(excludedDMs)
	const result: ClearAllResult = { dms: 0, channels: 0, skipped: 0 }

	const { ReadStateStore, ChannelStore, GuildStore, GuildChannelStore, ActiveJoinedThreadsStore } = Stores as any
	const dispatcher = (flux as any).Dispatcher
	if (!ReadStateStore || typeof dispatcher?.dispatch !== 'function') throw new Error('ReadStateStore or the dispatcher is missing')

	const acks: { channelId: string; messageId: string | null; readStateType: number }[] = []
	const seen = new Set<string>()
	const add = (id: string | undefined, bucket: 'dms' | 'channels') => {
		if (!id || seen.has(id)) return
		seen.add(id)
		if (!ReadStateStore.hasUnread?.(id)) return
		acks.push({ channelId: id, messageId: ReadStateStore.lastMessageId?.(id) ?? null, readStateType: 0 })
		result[bucket]++
	}

	// DMs and group DMs
	const dmIds: string[] = kind === 'servers' || onlyGuild ? [] : toArray<string>(ChannelStore?.getPrivateChannelIds?.())
	for (const id of dmIds) {
		if (excludedD.has(id)) result.skipped++
		else add(id, 'dms')
	}

	// Server channels and the threads you're in
	const guildIds: string[] = onlyGuild ? [onlyGuild] : kind === 'dms' ? [] : guildIdsOf(GuildStore)
	for (const guildId of guildIds) {
		if (!onlyGuild && excludedS.has(guildId)) {
			result.skipped++
			continue
		}
		const grouped = GuildChannelStore?.getChannels?.(guildId)
		for (const key of ['SELECTABLE', 'VOCAL']) {
			for (const entry of toArray<any>(grouped?.[key])) add(entry?.channel?.id ?? entry?.id, 'channels')
		}
		const threads = ActiveJoinedThreadsStore?.getActiveJoinedThreadsForGuild?.(guildId) ?? {}
		for (const byParent of toArray<any>(threads)) {
			for (const thread of toArray<any>(byParent)) add(thread?.channel?.id ?? thread?.id, 'channels')
		}
	}

	for (let i = 0; i < acks.length; i += CHUNK) {
		dispatcher.dispatch({ type: 'BULK_ACK', context: 'APP', channels: acks.slice(i, i + CHUNK) })
	}

	console.log(`[ReadAll] Cleared ${result.dms} DMs, ${result.channels} channels. Skipped ${result.skipped}.`)
	return result
}

/** One server (from its long-press menu). Exclusions don't apply: you picked this one. */
export function executeClearGuild(guildId: string): Promise<ClearAllResult> {
	return executeClearAll('servers', guildId)
}

/** Whether a chat is a DM or group DM (channel types 1 and 3), the only chats the button shows in. */
export function isPrivateChannel(channelId: string): boolean {
	try {
		const { ChannelStore } = Stores as any
		// Server channels and their threads carry a guild id; DMs never do.
		const channel = ChannelStore?.getChannel?.(channelId)
		if (!channel || channel.guild_id || channel.guildId) return false
		if (channel.type === 1 || channel.type === 3) return true
		return toArray<string>(ChannelStore?.getPrivateChannelIds?.()).includes(channelId)
	} catch {
		return false
	}
}

/** Unread DMs and group DMs the "all DMs" hold would mark, leaving out excluded ones. */
export function unreadDMCount(): number {
	try {
		const { excludedDMs } = getData()
		const { ReadStateStore, ChannelStore } = Stores as any
		return toArray<string>(ChannelStore?.getPrivateChannelIds?.()).filter(
			id => !excludedDMs.includes(id) && ReadStateStore?.hasUnread?.(id),
		).length
	} catch {
		return 0
	}
}

export function hasUnreadChannel(channelId: string): boolean {
	try {
		return !!(Stores as any).ReadStateStore?.hasUnread?.(channelId)
	} catch {
		return false
	}
}

/** One chat (the pill above the message box). Returns false when Discord couldn't be reached. */
export function markChannelRead(channelId: string): boolean {
	const { ReadStateStore } = Stores as any
	const dispatcher = (flux as any).Dispatcher
	if (!ReadStateStore || typeof dispatcher?.dispatch !== 'function') return false
	dispatcher.dispatch({
		type: 'BULK_ACK',
		context: 'APP',
		channels: [{ channelId, messageId: ReadStateStore.lastMessageId?.(channelId) ?? null, readStateType: 0 }],
	})
	return true
}

/**
 * ReadButton.tsx imports `executeClear` from this file, but only
 * `executeClearAll` was exported, which is what broke the build
 * ([MISSING_EXPORT] "executeClear" is not exported by Clear.ts).
 */
export const executeClear = executeClearAll
