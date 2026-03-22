import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import DashboardPage from './pages/DashboardPage/DashboardPage';
import SessionListPage from './pages/SessionListPage/SessionListPage';
import NewSessionPage from './pages/NewSessionPage/NewSessionPage';
import SessionPage from './pages/SessionPage/SessionPage';
import CpPage from './pages/CpPage/CpPage';
import RepoListPage from './pages/RepoListPage/RepoListPage';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/sessions" element={<SessionListPage />} />
        <Route path="/sessions/new" element={<NewSessionPage />} />
        <Route path="/sessions/:id" element={<SessionPage />} />
        <Route path="/cp" element={<CpPage />} />
        <Route path="/repos" element={<RepoListPage />} />
      </Routes>
    </Layout>
  );
}

export default App;
