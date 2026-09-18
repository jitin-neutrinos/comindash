import FrameCard from '../components/FrameCard'
import MetricInfo from '../components/MetricInfo'

/** Placeholder — wired up from the sidebar gear icon; content to follow. */
export default function Settings() {
  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-h2 font-semibold tracking-tight">Settings</h1>
          <MetricInfo metricKey="settingsPage" />
        </div>
        <p className="mt-1 font-light text-muted">Workspace and pipeline configuration.</p>
      </header>
      <FrameCard>
        <p className="text-body text-muted">This page is coming soon.</p>
      </FrameCard>
    </div>
  )
}
