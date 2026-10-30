import { Empty, Icon, Pill, Screen } from '../ui/kit';

/**
 * The page a module shows until it is built: the module's name, one plain sentence, and the shell every module uses
 * (header, action and filter bar, empty state). A module replaces it with its own screen in its index.tsx.
 */
export function ComingNext({ title, line, icon, action, filters = [] }: { title: string; line: string; icon: string; action: string; filters?: string[] }) {
  return (
    <Screen title={title} subtitle={line}>
      <div className="modbar" role="group" aria-label={`${title} actions and filters, coming in the next update`}>
        <button type="button" className="btn btn-fill btn-sm" disabled aria-disabled="true">
          <Icon name="plus" size={18} /> {action}
        </button>
        {filters.length > 0 && (
          <span className="modbar-filters" aria-hidden="true">
            {filters.map((f, i) => <span key={f} className={`chip ${i === 0 ? 'on' : ''}`}>{f}</span>)}
          </span>
        )}
        <Pill tone="accent">Coming next</Pill>
      </div>
      <Empty icon={icon} text={<><b>{title} arrives in the next update.</b><br />Nothing to do here yet: your other screens work as before.</>} />
    </Screen>
  );
}
