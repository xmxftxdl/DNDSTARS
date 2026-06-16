import { useEffect, useState } from 'react'
import { Navigate, Routes, Route } from 'react-router-dom'
import { PanelLeftOpen } from 'lucide-react'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import MapsPage from './pages/MapsPage'
import CharactersPage from './pages/CharactersPage'
import CombatPage from './pages/CombatPage'
import AIPage from './pages/AIPage'
import { modeFromPort } from './lib/appMode'
import { useMapStore } from './store/maps'
import { useCharacterStore } from './store/characters'

export default function App() {
  const [collapsed, setCollapsed] = useState(false)
  const endpointMode = modeFromPort()
  const loadSharedMaps = useMapStore((s) => s.loadShared)
  const loadSharedCharacters = useCharacterStore((s) => s.loadShared)

  useEffect(() => {
    void loadSharedMaps()
    void loadSharedCharacters()
    const timer = window.setInterval(() => {
      void loadSharedMaps()
      void loadSharedCharacters()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [endpointMode, loadSharedCharacters, loadSharedMaps])

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <iframe
        title="D20 dice preloader"
        src="/dice-box-frame.html?scale=6.4&seed=d20-preload&badge=0"
        className="dice-box-preload-frame"
        sandbox="allow-scripts allow-same-origin"
        aria-hidden="true"
      />
      {!collapsed && <Sidebar mode={endpointMode ?? undefined} onCollapse={() => setCollapsed(true)} />}
      <main className={`relative flex-1 overflow-y-auto py-6 pr-6 ${collapsed ? 'pl-16' : 'pl-6'}`}>
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            title="展开侧边栏"
            className="glass absolute left-3 top-3 z-50 flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 transition-colors hover:text-arcane-200"
          >
            <PanelLeftOpen className="h-5 w-5" />
          </button>
        )}
        <Routes>
          <Route path="/" element={endpointMode === 'player' ? <Navigate to="/maps" replace /> : <Dashboard />} />
          <Route path="/maps" element={<MapsPage />} />
          <Route path="/characters" element={<CharactersPage />} />
          {endpointMode !== 'player' && <Route path="/combat" element={<CombatPage />} />}
          {endpointMode !== 'player' && <Route path="/ai" element={<AIPage />} />}
          {endpointMode === 'player' && <Route path="*" element={<Navigate to="/maps" replace />} />}
        </Routes>
      </main>
    </div>
  )
}
