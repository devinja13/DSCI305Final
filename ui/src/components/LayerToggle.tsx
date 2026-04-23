import { useOptimizeStore, LayerType } from '../store/useOptimizeStore';

const LAYERS: { id: LayerType; label: string; color: string }[] = [
  { id: 'trees', label: 'Tree placement', color: 'bg-green-600' },
  { id: 'cooling', label: 'Cooling effect', color: 'bg-blue-500' },
  { id: 'regions', label: 'Selected regions', color: 'bg-amber-500' },
];

const LayerToggle: React.FC = () => {
  const { visibleLayers, toggleLayer } = useOptimizeStore();

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Layers</p>
      {LAYERS.map((layer) => (
        <label key={layer.id} className="flex items-center gap-2 cursor-pointer">
          <div className={`w-3 h-3 rounded-sm shrink-0 ${layer.color}`} />
          <input
            type="checkbox"
            className="sr-only"
            checked={visibleLayers.has(layer.id)}
            onChange={() => toggleLayer(layer.id)}
          />
          <span className="text-sm text-slate-700">{layer.label}</span>
        </label>
      ))}
    </div>
  );
};

export default LayerToggle;
