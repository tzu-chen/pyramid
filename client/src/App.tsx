import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import DashboardPage from './pages/DashboardPage/DashboardPage';
import SessionListPage from './pages/SessionListPage/SessionListPage';
import NewSessionPage from './pages/NewSessionPage/NewSessionPage';
import SessionPage from './pages/SessionPage/SessionPage';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/sessions" element={<SessionListPage />} />
        <Route path="/sessions/new" element={<NewSessionPage />} />
        <Route path="/sessions/:id" element={<SessionPage />} />
      </Routes>
    </Layout>
  );
}

export default App;
