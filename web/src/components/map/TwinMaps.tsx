import { useEffect } from 'react';
import L from 'leaflet';
import { CircleMarker, LayersControl, MapContainer, Rectangle, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useI18n } from '../../i18n';
import { analysisWindow } from '../../lib/geo';
import type { Site } from '../../types';
import { TerrainOverlays, TerrainTable, useLayerMeta } from './TerrainLayers';

const TREK = 'https://trek.nasa.gov/tiles';
const TREK_ATTR = 'NASA Solar System Treks';

// NASA Trek global layers are tiled in geographic (EPSG:4326) coordinates.
const PLANET_LAYERS = {
  mars: [
    { key: 'viking', url: `${TREK}/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`, maxNativeZoom: 7 },
    { key: 'mola', url: `${TREK}/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`, maxNativeZoom: 6 },
  ],
  moon: [
    { key: 'wac', url: `${TREK}/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`, maxNativeZoom: 7 },
    { key: 'lola', url: `${TREK}/Moon/EQ/LRO_LOLA_ClrShade_Global_128ppd_v04/1.0.0/default/default028mm/{z}/{y}/{x}.png`, maxNativeZoom: 6 },
  ],
} as const;

const WORLD: L.LatLngBoundsExpression = [[-90, -180], [90, 180]];

function FitWindow({ site }: { site: Site }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    // No animation: flyTo can leave tiles mis-positioned when the tab is throttled mid-flight.
    map.fitBounds(analysisWindow(site), { padding: [48, 48], animate: false, maxZoom: site.body === 'earth' ? 11 : 8 });
  }, [map, site]);
  return null;
}

interface MarkerProps {
  site: Site;
  selected: boolean;
  color: string;
  onSelect?: (id: string) => void;
}

function SiteMarker({ site, selected, color, onSelect }: MarkerProps) {
  const { loc, t } = useI18n();
  return (
    <>
      {selected && (
        <Rectangle bounds={analysisWindow(site)} pathOptions={{ color, weight: 2, dashArray: '6 6', fillOpacity: 0.06 }}>
          <Tooltip sticky>{t('explorer.window')}</Tooltip>
        </Rectangle>
      )}
      <CircleMarker
        center={[site.lat, site.lon]}
        radius={selected ? 9 : 6}
        pathOptions={{ color: '#fff', weight: selected ? 3 : 1.5, fillColor: color, fillOpacity: 0.95 }}
        eventHandlers={{ click: () => onSelect?.(site.id) }}
      >
        <Tooltip direction="top" offset={[0, -8]}>{loc(site.name)}</Tooltip>
      </CircleMarker>
    </>
  );
}

interface Props {
  earthSites: Site[];
  earth: Site;
  targets: Site[];
  target: Site;
  onSelectEarth?: (id: string) => void;
  onSelectTarget?: (id: string) => void;
}

export default function TwinMaps({ earthSites, earth, targets, target, onSelectEarth, onSelectTarget }: Props) {
  const { t, loc } = useI18n();
  const sameBody = targets.filter((s) => s.body === target.body);
  const planetColor = target.body === 'mars' ? '#e0703f' : '#b8c2d6';
  const earthLayers = useLayerMeta(earth);
  const targetLayers = useLayerMeta(target);

  return (
    <>
    <div className="twin-maps">
      <figure className="map-panel">
        <figcaption>
          <span className="dot earth" /> {t('explorer.earthMap')} · <strong>{loc(earth.name)}</strong>
        </figcaption>
        <MapContainer center={[earth.lat, earth.lon]} zoom={9} scrollWheelZoom className="map">
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name={t('explorer.imagery')}>
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution="Esri, Maxar, Earthstar Geographics"
                maxZoom={17}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name={t('explorer.topo')}>
              <TileLayer
                url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                attribution="© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)"
                maxZoom={17}
              />
            </LayersControl.BaseLayer>
            <TerrainOverlays site={earth} meta={earthLayers} />
          </LayersControl>
          {earthSites.map((s) => (
            <SiteMarker key={s.id} site={s} selected={s.id === earth.id} color="#3fb6a8" onSelect={onSelectEarth} />
          ))}
          <FitWindow site={earth} />
        </MapContainer>
      </figure>

      <figure className="map-panel">
        <figcaption>
          <span className={`dot ${target.body}`} /> {t(`body.${target.body}`)} · <strong>{loc(target.name)}</strong>
        </figcaption>
        <MapContainer
          key={target.body}
          crs={L.CRS.EPSG4326}
          center={[target.lat, target.lon]}
          zoom={5}
          minZoom={1}
          maxZoom={10}
          maxBounds={WORLD}
          scrollWheelZoom
          className="map"
        >
          <LayersControl position="topright">
            {PLANET_LAYERS[target.body as 'mars' | 'moon'].map((layer, i) => (
              <LayersControl.BaseLayer key={layer.key} checked={i === 0} name={t(`explorer.${layer.key}`)}>
                <TileLayer url={layer.url} attribution={TREK_ATTR} tileSize={256} maxNativeZoom={layer.maxNativeZoom} maxZoom={10} noWrap bounds={WORLD} />
              </LayersControl.BaseLayer>
            ))}
            <TerrainOverlays site={target} meta={targetLayers} />
          </LayersControl>
          {sameBody.map((s) => (
            <SiteMarker key={s.id} site={s} selected={s.id === target.id} color={planetColor} onSelect={onSelectTarget} />
          ))}
          <FitWindow site={target} />
        </MapContainer>
      </figure>
    </div>
    <p className="muted small terrain-help">{t('terrain.help')}</p>
    <TerrainTable sites={[{ site: earth, meta: earthLayers }, { site: target, meta: targetLayers }]} />
    </>
  );
}
