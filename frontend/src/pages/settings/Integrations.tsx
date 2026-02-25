import type { FC } from 'react'
import { Puzzle } from 'lucide-react'

const integrations = [
    { name: 'Google Calendar', desc: 'Sync meetings with your Google Calendar', connected: false },
    { name: 'Slack', desc: 'Send meeting summaries and task reminders to Slack', connected: false },
    { name: 'Zoom', desc: 'Start Zoom meetings directly from the app', connected: false },
    { name: 'Microsoft Teams', desc: 'Integrate with Teams for meetings and channels', connected: false },
]

const Integrations: FC = () => (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-w-lg">
        <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                <Puzzle size={20} className="text-purple-600" />
            </div>
            <div>
                <h2 className="text-lg font-semibold text-slate-900">Integrations</h2>
                <p className="text-sm text-slate-500">Connect your favourite tools</p>
            </div>
        </div>

        <div className="space-y-3">
            {integrations.map(({ name, desc, connected }) => (
                <div
                    key={name}
                    className="flex items-center justify-between gap-4 p-4 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
                >
                    <div>
                        <p className="text-sm font-semibold text-slate-800">{name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                    </div>
                    <button
                        disabled
                        className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${connected
                                ? 'bg-green-100 text-green-700'
                                : 'border border-slate-300 text-slate-500 cursor-not-allowed'
                            }`}
                    >
                        {connected ? 'Connected' : 'Coming soon'}
                    </button>
                </div>
            ))}
        </div>
    </div>
)

export default Integrations
