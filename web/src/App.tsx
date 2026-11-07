import { HashRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import Layout from './components/Layout';
import { useI18n } from './i18n';
import { useDataState } from './lib/data';
import Explorer from './pages/Explorer';
import Home from './pages/Home';
import Methodology from './pages/Methodology';
import Minerals from './pages/Minerals';
import Mission from './pages/Mission';
import About from './pages/About';
import Atlas from './pages/Atlas';
import Present from './pages/Present';
import SiteDetail from './pages/SiteDetail';
import Sources from './pages/Sources';

/** Old /compare?earth=..&target=.. links open the Compare tab of the Explorer. */
function CompareRedirect() {
  const [params] = useSearchParams();
  const next = new URLSearchParams({ view: 'compare' });
  const earth = params.get('earth');
  const target = params.get('target');
  if (earth) next.set('site', earth);
  if (target) next.set('target', target);
  return <Navigate to={`/explorer?${next}`} replace />;
}

export default function App() {
  const state = useDataState();
  const { t } = useI18n();

  if (state.status === 'loading') return <div className="center-msg">{t('app.loading')}</div>;
  if (state.status === 'error') return <div className="center-msg error">{t('app.loadError')}</div>;

  // HashRouter: static hosting (GitHub Pages / Firebase) needs no rewrite rules.
  return (
    <HashRouter>
      <Routes>
        <Route path="present" element={<Present />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="explorer" element={<Explorer />} />
          <Route path="site/:id" element={<SiteDetail />} />
          <Route path="compare" element={<CompareRedirect />} />
          <Route path="minerals" element={<Minerals />} />
          <Route path="methodology" element={<Methodology />} />
          <Route path="sources" element={<Sources />} />
          <Route path="mission" element={<Mission />} />
          <Route path="about" element={<About />} />
          <Route path="atlas" element={<Atlas />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
