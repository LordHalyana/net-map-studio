import { libraryCatalog } from '../library/catalog';
import { useAppStore } from '../state/store';
import { buildDevice, opCreateDevice } from '../state/ops';
import type { DeviceType } from '@netplan/domain';

let dropOffset = 0;

export function LibraryPanel() {
  const project = useAppStore((s) => s.project);
  const graph = useAppStore((s) => s.graph);
  const dispatch = useAppStore((s) => s.dispatch);

  function addDevice(deviceType: DeviceType) {
    if (!project || !graph) return;
    dropOffset = (dropOffset + 1) % 12;
    const existingNames = new Set(graph.devices.map((d) => d.name));
    const device = buildDevice(
      project.id,
      deviceType,
      { x: 120 + dropOffset * 40, y: 120 + dropOffset * 30 },
      existingNames,
    );
    dispatch(opCreateDevice(project.id, device));
  }

  return (
    <nav className="library-panel" data-testid="library-panel">
      <h2 className="panel-title">Components</h2>
      {libraryCatalog.map((category) => (
        <section key={category.key} className="library-category">
          <h3>{category.label}</h3>
          <ul>
            {category.items.map((item) => (
              <li key={item.deviceType}>
                <button
                  type="button"
                  className="library-item"
                  data-testid={`library-item-${item.deviceType}`}
                  onClick={() => addDevice(item.deviceType)}
                  onDoubleClick={() => addDevice(item.deviceType)}
                >
                  <span className="library-item__glyph">{item.glyph}</span>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
