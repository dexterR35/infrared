// Screens that only some roles open load on demand, keeping the initial bundle small.
import {Component, lazy, Suspense, type ComponentType, type ReactNode} from 'react';

class RouteBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() {
    return {failed: true};
  }
  render() {
    return this.state.failed ? (
      <div className="quiet-state" role="alert">
        This section could not load. Refresh the page to retry.
      </div>
    ) : (
      this.props.children
    );
  }
}

function deferred<P extends object>(load: () => Promise<ComponentType<P>>) {
  const Screen = lazy(() => load().then((component) => ({default: component})));
  return function LazyScreen(props: P) {
    return (
      <RouteBoundary>
        <Suspense
          fallback={
            <div className="quiet-state" role="status">
              Loading…
            </div>
          }
        >
          <Screen {...(props as any)} />
        </Suspense>
      </RouteBoundary>
    );
  };
}

type Growth = typeof import('./growth-dashboard.js');
type Intelligence = typeof import('./intelligence-panel.js');
export const MarketRegistry = deferred<Parameters<Growth['MarketRegistry']>[0]>(() =>
  import('./growth-dashboard.js').then((m) => m.MarketRegistry),
);
export const AcquisitionDashboard = deferred<Parameters<Growth['AcquisitionDashboard']>[0]>(() =>
  import('./growth-dashboard.js').then((m) => m.AcquisitionDashboard),
);
export const ExperimentsDashboard = deferred<Parameters<Growth['ExperimentsDashboard']>[0]>(() =>
  import('./growth-dashboard.js').then((m) => m.ExperimentsDashboard),
);
export const IntelligencePanel = deferred<Parameters<Intelligence['IntelligencePanel']>[0]>(() =>
  import('./intelligence-panel.js').then((m) => m.IntelligencePanel),
);
