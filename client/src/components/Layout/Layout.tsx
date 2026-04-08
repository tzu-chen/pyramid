import { ReactNode, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ThemeMenu } from '../ThemeMenu/ThemeMenu';
import SettingsModal from '../SettingsModal/SettingsModal';
import styles from './Layout.module.css';

interface LayoutProps {
  children: ReactNode;
}

function Layout({ children }: LayoutProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <h1 className={styles.logoText}>Pyramid</h1>
        </div>
        <nav className={styles.nav}>
          <NavLink to="/" end className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            Dashboard
          </NavLink>
          <NavLink to="/sessions" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            Sessions
          </NavLink>
          <NavLink to="/sessions/new" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            New Session
          </NavLink>
        </nav>
        <div className={styles.sidebarFooter}>
          <ThemeMenu />
          <button className={styles.settingsBtn} onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </aside>
      <main className={styles.main}>
        {children}
      </main>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default Layout;
