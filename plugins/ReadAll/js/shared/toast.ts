import { ToastActionCreators } from '@revenge-mod/discord/actions'

/**
 * A toast that reaches Discord's toast system on every build we support, shared by every plugin
 * that shows one. Each plugin imports this and passes its own key, so the dedupe stays per plugin.
 * Never call `ToastActionCreators.open` directly: its signature changed twice and the wrong one
 * crashes the whole app.
 *
 * ## The three signatures
 *
 * - **Up to 349.x:** `open({ key, content })`, the legacy toast.
 * - **350.2–350.3:** the mana (design-system) toast store arrived. `open(toast)` still takes the
 *   legacy object but only reaches the store when `toManaToast` accepts it (string `content`,
 *   `containerStyle: null`, `disableAnimations: true`); anything else falls back to a legacy
 *   `TOAST_OPEN` that is silently swallowed. Next to it sits `openMana(key, { text })`, which
 *   writes the store directly.
 * - **350.4+:** `openMana` was renamed to `open` and the one-object `open` is gone. Now
 *   `open(key, toast)` is the only entry point. An old-style `open({ key, content })` passes the
 *   object as the key and `undefined` as the toast; the store stores `{ toast: undefined }` and
 *   `useToastContainer` throws "Cannot read property 'position' of undefined" at the root render.
 *
 * ## How this picks one
 *
 * `openMana` present means 350.2–350.3: use it. Otherwise call `open(legacy, mana)`: 350.4+ reads
 * only the second argument as the toast (the first is compared by identity for its dedupe, so an
 * object there just never dedupes), and pre-350.2 builds read only the first. This avoids sniffing
 * `open.length`, which a patched or wrapped `open` would report as 0.
 *
 * See `docs/debugging/discord-toast-system.md` for the bundle trace. `revenge.*` is only read
 * inside the function (docs/porting-rules.md rule 1).
 */
export function showToast(content: string, key = 'SharedToast') {
	try {
		// The vendored `ToastActionCreators` types describe the pre-350.2 one-object `open`.
		const creators = ToastActionCreators as any
		const mana = { text: content }
		if (typeof creators.openMana === 'function') {
			creators.openMana(key, mana)
			return
		}
		creators.open({ key, content }, mana)
	} catch {
		/* a missing toast must never take the app down */
	}
}
