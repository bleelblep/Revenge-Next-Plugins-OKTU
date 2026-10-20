/**
 * A layer over the whole app for floating controls, JS only.
 *
 * React Native's `AppRegistry.setWrapperComponentProvider` wraps the app's root component; the
 * layer is drawn on top of Discord there, the way Discord Redesign's `root.tsx` draws its screen.
 * The provider is read once when the app starts, so:
 *
 * - `watchFloatingRoot(cleanup)` goes in `preInit`: it remembers the provider Revenge or another
 *   plugin set, so ours wraps theirs instead of replacing it.
 * - `installFloatingRoot()` goes in `start`. A plugin enabled after boot (`plugin.startedLate`)
 *   is too late for that; call `plugin.requireReload()` instead.
 *
 * Plugins put things on the layer with `addFloating(id, render)` and take them off with the
 * function it returns. `refreshFloating()` re-renders them after a setting changes. Each item has
 * its own error boundary, so a broken one disappears instead of taking the app down.
 *
 * Each plugin bundles its own copy, so the state below is per plugin.
 */

import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import * as patcher from '@revenge-mod/patcher'
import * as React from 'react'
import * as ReactNative from 'react-native'

export interface FloatingOptions {
	/** Hide while the keyboard is open (it would sit over the text being typed). */
	hideWithKeyboard?: boolean
}

interface Item {
	render: () => React.ReactNode
	options: FloatingOptions
}

const items = new Map<string, Item>()
const listeners = new Set<() => void>()

let registry: any
let previousProvider: any
let installedProvider: any
let ownsProvider = false
let onError: ((context: string, error: unknown) => void) | undefined

function emit() {
	for (const listener of listeners) listener()
}

export function addFloating(id: string, render: () => React.ReactNode, options: FloatingOptions = {}): () => void {
	items.set(id, { render, options })
	emit()
	return () => {
		if (items.get(id)?.render !== render) return
		items.delete(id)
		emit()
	}
}

export function refreshFloating() {
	emit()
}

/** Where item render errors go (e.g. `reportError` from shared/report.ts). */
export function onFloatingError(handler: typeof onError) {
	onError = handler
}

let Boundary: any
function getBoundary() {
	Boundary ??= class FloatingBoundary extends React.Component<{ id: string; children?: React.ReactNode }, { failed: boolean }> {
		state = { failed: false }
		static getDerivedStateFromError() {
			return { failed: true }
		}
		componentDidCatch(error: unknown) {
			onError?.(`floating item ${this.props.id} failed`, error)
		}
		render() {
			return this.state.failed ? null : this.props.children
		}
	}
	return Boundary
}

function Layer() {
	const { View, Keyboard, StyleSheet } = ReactNative
	const [, setTick] = React.useState(0)
	const [keyboard, setKeyboard] = React.useState(false)

	React.useEffect(() => {
		const listener = () => setTick(n => n + 1)
		listeners.add(listener)
		const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true))
		const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false))
		return () => {
			listeners.delete(listener)
			show.remove()
			hide.remove()
		}
	}, [])

	if (!items.size) return null
	const ItemBoundary = getBoundary()
	return (
		<View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
			{[...items].map(([id, item]) =>
				keyboard && item.options.hideWithKeyboard ? null : (
					<ItemBoundary key={id} id={id}>
						{item.render()}
					</ItemBoundary>
				),
			)}
		</View>
	)
}

/** Call in `preInit` (when not `startedLate`): remembers the root provider set before ours. */
export function watchFloatingRoot(cleanup: (...fns: Array<() => void>) => void) {
	cleanup(
		getModules(withProps('setWrapperComponentProvider', 'runApplication'), (mod: any) => {
			registry = mod
			cleanup(
				patcher.before(mod, 'setWrapperComponentProvider', (args: any[]) => {
					if (args[0] !== installedProvider) {
						previousProvider = args[0]
						ownsProvider = false
					}
					return args
				}),
			)
		}),
	)
}

/** Call in `start`: wraps the app's main root so the layer draws over it. Returns the undo. */
export function installFloatingRoot(): () => void {
	registry ??= (ReactNative as any).AppRegistry
	if (typeof registry?.setWrapperComponentProvider !== 'function') throw new Error('AppRegistry wrapper hook unavailable')
	const previous = previousProvider
	let rootTag: unknown
	let Wrapper: any
	installedProvider = (params: any) => {
		const Original = previous?.(params)
		// Only the main app; other RN surfaces keep their own wrapper.
		rootTag ??= params.rootTag
		if (params.rootTag !== rootTag) return Original
		// Same component every time, or React would remount the whole app.
		Wrapper ??= function FloatingAppWrapper(props: any) {
			const { View } = ReactNative
			return (
				<View style={{ flex: 1 }}>
					{Original ? <Original {...props} /> : props.children}
					<Layer />
				</View>
			)
		}
		return Wrapper
	}
	registry.setWrapperComponentProvider(installedProvider)
	ownsProvider = true
	return () => {
		if (ownsProvider) registry.setWrapperComponentProvider(previous)
		installedProvider = undefined
		ownsProvider = false
	}
}
