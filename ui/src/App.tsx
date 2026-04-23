import MapView from './components/MapView';
import ControlPanel from './components/ControlPanel';
import MetricsPanel from './components/MetricsPanel';

function App() {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-planning-light">

      {/* Top Header */}
      <header className="h-14 bg-white border-b border-slate-200 shadow-sm flex items-center px-6 z-30 shrink-0">
        <div className="flex items-center">
          <div className="w-8 h-8 bg-planning-accent rounded flex items-center justify-center mr-3 text-white font-bold text-xl leading-none">
            H
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-800 leading-tight">HARC Urban Forestry</h1>
            <h2 className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Optimization Platform</h2>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Map View takes remaining space */}
        <div className="flex-1 relative z-10">
          <MapView />
        </div>

        {/* Control Panel on the right */}
        <ControlPanel />
      </div>

      {/* Bottom Metrics Panel */}
      <div className="shrink-0 z-20 relative">
        <MetricsPanel />
      </div>

    </div>
  );
}

export default App;
