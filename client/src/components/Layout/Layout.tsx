import { ReactNode, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import SettingsModal from '../SettingsModal/SettingsModal';
import {
  ChevronLeftIcon,
  GridIcon,
  ListIcon,
  PlusIcon,
  SettingsIcon,
} from '../Icons/Icons';
import styles from './Layout.module.css';

interface LayoutProps {
  children: ReactNode;
}

const COLLAPSED_KEY = 'pyramid_sidebar_collapsed';

function Layout({ children }: LayoutProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  });

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `${styles.navLink} ${isActive ? styles.active : ''}`;

  return (
    <div className={`${styles.layout} ${collapsed ? styles.layoutCollapsed : ''}`}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          {!collapsed && <h1 className={styles.logoText}>Pyramid</h1>}
          <button
            className={styles.collapseBtn}
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeftIcon size={16} className={collapsed ? styles.chevronFlipped : ''} />
          </button>
        </div>
        <nav className={styles.nav}>
          <NavLink to="/" end className={navLinkClass} title="Dashboard">
            <GridIcon size={18} />
            <span className={styles.navLabel}>Dashboard</span>
          </NavLink>
          <NavLink to="/sessions" className={navLinkClass} title="Sessions">
            <ListIcon size={18} />
            <span className={styles.navLabel}>Sessions</span>
          </NavLink>
          <NavLink to="/sessions/new" className={navLinkClass} title="New Session">
            <PlusIcon size={18} />
            <span className={styles.navLabel}>New Session</span>
          </NavLink>
        </nav>
        <div className={styles.sidebarFooter}>
          <button
            className={styles.settingsBtn}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            <SettingsIcon size={18} />
            <span className={styles.navLabel}>Settings</span>
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
