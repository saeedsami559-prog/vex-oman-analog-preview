import { useEffect } from 'react';
import { CircleMarker, LayersControl, MapContainer, Rectangle, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useI18n } from '../../i18n';
import { analysisWindow } from '../../lib/geo';
import type { Site } from '../../types';
import { TerrainOverlays, useLayerMeta } from './TerrainLayers';

function Fit({ site }: { site: Site }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    map.fitBounds(analysisWindow(site), { padding: [24, 24], animate: false, maxZoom: 13 });
  }, [map, site]);
  return null;
}

/** Satellite map of one Earth site: imagery, the analysis window and the NASADEM terrain layers. */
export default function SiteMap({ site }: { site: Site }) {
  const { t, loc } = useI18n();
  const meta = useLayerMeta(site);
  return (
    <figure className="map-panel site-map">
      <figcaption>
        <span className="dot earth" /> {t('site.mapTitle')} · <strong>{loc(site.name)}</strong>
      </figcaption>
      <MapContainer center={[site.lat, site.lon]} zoom={10} scrollWheelZoom className="map">
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
          <TerrainOverlays site={site} meta={meta} />
        </LayersControl>
        <Rectangle bounds={analysisWindow(site)} pathOptions={{ color: '#3fb6a8', weight: 2, dashArray: '6 6', fillOpacity: 0.05 }}>
          <Tooltip sticky>{t('explorer.window')}</Tooltip>
        </Rectangle>
        <CircleMarker center={[site.lat, site.lon]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: '#3fb6a8', fillOpacity: 0.95 }}>
          <Tooltip direction="top" offset={[0, -8]}>{loc(site.name)}</Tooltip>
        </CircleMarker>
        <Fit site={site} />
      </MapContainer>
      <p className="muted small map-note">{t('site.mapNote')}</p>
    </figure>
  );
}
