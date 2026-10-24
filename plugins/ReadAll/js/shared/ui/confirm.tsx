import { AlertActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'

/**
 * Asks before a destructive action, in Discord's own alert dialog (`AlertModal`), with the action
 * in red above Cancel. For danger rows (docs/plugin-design-language.md §3.8 and checklist item 6).
 *
 * Call from an event handler: `revenge.*` is read here, so module scope is out (porting rule 1).
 */
export function confirmDestructive(options: {
	title: string
	body: string
	action: string
	onConfirm(): void
}) {
	const { AlertModal, AlertActionButton } = Design as any
	const Alerts = AlertActionCreators as any
	const key = `bleelblep-confirm-${Date.now()}`
	Alerts.openAlert(
		key,
		<AlertModal
			title={options.title}
			content={options.body}
			actions={
				<>
					<AlertActionButton
						text={options.action}
						variant="destructive"
						onPress={() => {
							Alerts.dismissAlert(key)
							options.onConfirm()
						}}
					/>
					<AlertActionButton text="Cancel" variant="secondary" onPress={() => Alerts.dismissAlert(key)} />
				</>
			}
		/>,
	)
}
